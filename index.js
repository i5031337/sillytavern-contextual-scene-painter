import { SlashCommandParser } from '/scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '/scripts/slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE } from '/scripts/slash-commands/SlashCommandArgument.js';
import { getContext } from '/scripts/extensions.js';

import {
    getModuleSettings,
    isEditPromptEnabled,
    promptUserForEdit,
    initExtensionSettings,
    mountExtensionUI
} from './settings.js';

import {
    buildImagePrompt,
    sanitizePromptForSlashCommand,
    parseBoolArg
} from './prompt-builder.js';

import {
    dispatchToSD,
    uploadAndSetBackground,
    quoteSlashArg,
    readActiveProfileName
} from './api-connection.js';

// Re-export submodules for extension consumers/scripts
export * from './settings.js';
export * from './prompt-builder.js';
export * from './api-connection.js';

// ==========================================
// SLASH COMMAND 1: /drawbg (Chat Background)
// ==========================================

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'drawbg',
    aliases: ['genbg', 'bgdraw', 'paintbg'],
    returns: 'Generates an environment background image and applies it to the chat background',
    namedArguments: [
        { name: 'card', description: 'Character card name or boolean flag (default: from settings)', type: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.BOOLEAN], required: false },
        { name: 'width', description: 'Image width (default: 1920)', type: [ARGUMENT_TYPE.NUMBER], required: false },
        { name: 'height', description: 'Image height (default: 1080)', type: [ARGUMENT_TYPE.NUMBER], required: false },
        { name: 'negative', description: 'Negative prompt additions for this generation', type: [ARGUMENT_TYPE.STRING], required: false },
        { name: 'persona', description: 'Include active Persona description (default: from settings)', type: [ARGUMENT_TYPE.BOOLEAN], required: false },
        { name: 'worldinfo', description: 'Include active World Info entries (default: from settings)', type: [ARGUMENT_TYPE.BOOLEAN], required: false },
        { name: 'messageid', description: 'Generate from this message ID (and prior context) instead of the most recent message', type: [ARGUMENT_TYPE.NUMBER], required: false }
    ],
    unnamedArguments: [{ description: 'One-off direction for the prompt generator LLM', type: [ARGUMENT_TYPE.STRING], required: false }],
    callback: async (args, value) => {
        const moduleSettings = getModuleSettings();
        const userInstruction = typeof value === 'string' ? value.trim() : '';
        const rawCard = args?.card;
        const width = args?.width || 1920;
        const height = args?.height || 1080;
        const negativePrompt = typeof args?.negative === 'string' ? args.negative.trim() : '';
        const includePersona = parseBoolArg(args?.persona, moduleSettings.includePersona !== false);
        const includeWorldInfo = parseBoolArg(args?.worldinfo, moduleSettings.includeWorldInfo !== false);
        const rawMessageId = args?.messageid;
        const messageId = (rawMessageId !== undefined && rawMessageId !== null && rawMessageId !== '') ? Number(rawMessageId) : null;

        let includeCharacter = moduleSettings.includeCharacter !== false;
        let targetCard = null;

        if (rawCard !== undefined && rawCard !== null && rawCard !== '') {
            const parsedBool = parseBoolArg(rawCard, null);
            if (parsedBool === false) {
                includeCharacter = false;
                targetCard = null;
            } else if (parsedBool === true) {
                includeCharacter = true;
                targetCard = null;
            } else {
                includeCharacter = true;
                targetCard = String(rawCard).trim();
            }
        }

        if (typeof toastr !== 'undefined') toastr.info('Generating background image...');

        try {
            const context = getContext();
            let finalPrompt = await buildImagePrompt(userInstruction, targetCard, 'genbg', {
                includePersona,
                includeWorldInfo,
                includeCharacter,
                messageId
            });

            if (isEditPromptEnabled()) {
                const editedPrompt = await promptUserForEdit(finalPrompt);
                if (editedPrompt === null) {
                    if (typeof toastr !== 'undefined') toastr.info('Background generation cancelled.');
                    return '';
                }
                finalPrompt = editedPrompt;
            }
            finalPrompt = sanitizePromptForSlashCommand(finalPrompt);

            if (!finalPrompt) {
                throw new Error('LLM generated an empty image prompt.');
            }

            let sdCommand = `/sd raw=true quiet=true width=${width} height=${height}`;
            if (negativePrompt) sdCommand += ` negative=${quoteSlashArg(negativePrompt)}`;
            sdCommand += ` ${quoteSlashArg(finalPrompt)}`;

            const sdResult = await dispatchToSD(context, sdCommand);

            let imageUrl = null;
            const rawPipe = sdResult?.pipe ?? sdResult?.value ?? sdResult;

            if (typeof rawPipe === 'string') {
                const trimmed = rawPipe.trim();
                if (trimmed.startsWith('user/images') || trimmed.startsWith('/user/images') || trimmed.startsWith('http')) {
                    imageUrl = trimmed;
                } else {
                    const matches = [...trimmed.matchAll(/(?:src=["']?|!\[.*?\]\()([^"'\s\)]+)/gi)];
                    if (matches.length > 0) imageUrl = matches[matches.length - 1][1];
                }
            }

            if (!imageUrl) {
                const strResult = typeof sdResult === 'object' ? JSON.stringify(sdResult) : String(sdResult);
                const pathMatches = [...strResult.matchAll(/(user\/images\/[^\s"':]+\.(?:png|jpg|jpeg|webp))/gi)];
                if (pathMatches.length > 0) imageUrl = pathMatches[pathMatches.length - 1][1];
            }

            if (!imageUrl) throw new Error('Image generator did not return a valid image path');
            await uploadAndSetBackground(imageUrl);

        } catch (err) {
            if (typeof toastr !== 'undefined') toastr.error(`Background generation failed: ${err.message}`);
        }
        return '';
    },
    helpString: 'Generates a custom background using /drawbg [card="Card Name"|true|false] [width=1920] [height=1080] [negative="..."] [persona=true|false] [worldinfo=true|false] [messageid=x] [optional direction]. messageid generates from message x (and prior context) instead of the most recent message.',
}));

// ==========================================
// SLASH COMMAND 2: /drawscene (Inline Scene)
// ==========================================

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'drawscene',
    aliases: ['gencustom', 'genchat', 'snapshot', 'drawchat'],
    returns: 'the path/URL of the generated image, so it can be piped into another command (e.g. /drawscene | /something {{pipe}})',
    namedArguments: [
        { name: 'card', description: 'Character card name or boolean flag (default: from settings)', type: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.BOOLEAN], required: false },
        { name: 'width', description: 'Image width (optional)', type: [ARGUMENT_TYPE.NUMBER], required: false },
        { name: 'height', description: 'Image height (optional)', type: [ARGUMENT_TYPE.NUMBER], required: false },
        { name: 'negative', description: 'Negative prompt additions for this generation', type: [ARGUMENT_TYPE.STRING], required: false },
        { name: 'persona', description: 'Include active Persona description (default: from settings)', type: [ARGUMENT_TYPE.BOOLEAN], required: false },
        { name: 'worldinfo', description: 'Include active World Info entries (default: from settings)', type: [ARGUMENT_TYPE.BOOLEAN], required: false },
        { name: 'messageid', description: 'Generate from this message ID (and prior context) instead of the most recent message', type: [ARGUMENT_TYPE.NUMBER], required: false }
    ],
    unnamedArguments: [{ description: 'One-off direction for the prompt generator LLM', type: [ARGUMENT_TYPE.STRING], required: false }],
    callback: async (args, value) => {
        const moduleSettings = getModuleSettings();
        const userInstruction = typeof value === 'string' ? value.trim() : '';
        const rawCard = args?.card;
        const negativePrompt = typeof args?.negative === 'string' ? args.negative.trim() : '';
        const includePersona = parseBoolArg(args?.persona, moduleSettings.includePersona !== false);
        const includeWorldInfo = parseBoolArg(args?.worldinfo, moduleSettings.includeWorldInfo !== false);
        const rawMessageId = args?.messageid;
        const messageId = (rawMessageId !== undefined && rawMessageId !== null && rawMessageId !== '') ? Number(rawMessageId) : null;

        let includeCharacter = moduleSettings.includeCharacter !== false;
        let targetCard = null;

        if (rawCard !== undefined && rawCard !== null && rawCard !== '') {
            const parsedBool = parseBoolArg(rawCard, null);
            if (parsedBool === false) {
                includeCharacter = false;
                targetCard = null;
            } else if (parsedBool === true) {
                includeCharacter = true;
                targetCard = null;
            } else {
                includeCharacter = true;
                targetCard = String(rawCard).trim();
            }
        }

        if (typeof toastr !== 'undefined') toastr.info('Generating scene image...');

        try {
            const context = getContext();
            console.debug('[scene-painter] drawscene: building image prompt...');
            let finalPrompt = await buildImagePrompt(userInstruction, targetCard, 'gencustom', {
                includePersona,
                includeWorldInfo,
                includeCharacter,
                messageId
            });
            console.debug('[scene-painter] drawscene: prompt built, showing edit popup:', finalPrompt);

            if (isEditPromptEnabled()) {
                const editedPrompt = await promptUserForEdit(finalPrompt);
                if (editedPrompt === null) {
                    if (typeof toastr !== 'undefined') toastr.info('Image generation cancelled.');
                    return '';
                }
                finalPrompt = editedPrompt;
            }
            finalPrompt = sanitizePromptForSlashCommand(finalPrompt);

            if (!finalPrompt) {
                throw new Error('LLM generated an empty image prompt.');
            }

            let sdCommand = `/sd raw=true`;
            if (args?.width) sdCommand += ` width=${args.width}`;
            if (args?.height) sdCommand += ` height=${args.height}`;
            if (negativePrompt) sdCommand += ` negative=${quoteSlashArg(negativePrompt)}`;
            sdCommand += ` ${quoteSlashArg(finalPrompt)}`;

            try {
                const activeProfile = await readActiveProfileName(context);
                console.debug(`[scene-painter] drawscene: dispatching to /sd with profile "${activeProfile || '(none)'}":`, finalPrompt);
            } catch (err) {
                console.debug('[scene-painter] drawscene: dispatching to /sd (could not read active profile for logging):', finalPrompt);
            }

            const sdResult = await dispatchToSD(context, sdCommand);
            console.debug('[scene-painter] drawscene: /sd returned:', sdResult);

            let imageUrl = null;
            const rawPipe = sdResult?.pipe ?? sdResult?.value ?? sdResult;

            if (typeof rawPipe === 'string') {
                const trimmed = rawPipe.trim();
                if (trimmed.startsWith('user/images') || trimmed.startsWith('/user/images') || trimmed.startsWith('http')) {
                    imageUrl = trimmed;
                } else {
                    const matches = [...trimmed.matchAll(/(?:src=["']?|!\[.*?\]\()([^"'\s\)]+)/gi)];
                    if (matches.length > 0) imageUrl = matches[matches.length - 1][1];
                }
            }

            if (!imageUrl) {
                const strResult = typeof sdResult === 'object' ? JSON.stringify(sdResult) : String(sdResult);
                const pathMatches = [...strResult.matchAll(/(user\/images\/[^\s"':]+\.(?:png|jpg|jpeg|webp))/gi)];
                if (pathMatches.length > 0) imageUrl = pathMatches[pathMatches.length - 1][1];
            }

            if (typeof toastr !== 'undefined') toastr.success('Scene image requested!');

            return imageUrl || (typeof rawPipe === 'string' ? rawPipe : '');

        } catch (err) {
            if (typeof toastr !== 'undefined') toastr.error(`Scene image generation failed: ${err.message}`);
        }
        return '';
    },
    helpString: 'Generates a scene image in chat using /drawscene [card="Card Name"|true|false] [width=(sd default)] [height=(sd default)] [negative="..."] [persona=true|false] [worldinfo=true|false] [messageid=x] [optional direction]. messageid generates from message x (and prior context) instead of the most recent message. Returns the generated image path via {{pipe}}, so it can be chained, e.g. /drawscene | /something-else {{pipe}}.',
}));
