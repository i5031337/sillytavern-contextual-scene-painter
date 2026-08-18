import { SlashCommandParser } from '/scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '/scripts/slash-commands/SlashCommand.js';
import { SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } from '/scripts/slash-commands/SlashCommandArgument.js';
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

function resolveCardOption(rawCard, defaultIncludeCharacter) {
    let includeCharacter = defaultIncludeCharacter !== false;
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

    return { includeCharacter, targetCard };
}

function extractImageUrl(sdResult) {
    if (!sdResult) return '';
    const raw = (sdResult?.pipe ?? sdResult?.value ?? sdResult);
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.startsWith('user/images') || trimmed.startsWith('/user/images') || trimmed.startsWith('http')) {
            return trimmed;
        }
        const matches = [...trimmed.matchAll(/(?:src=["']?|!\[.*?\]\()([^"'\s\)]+)/gi)];
        if (matches.length > 0) return matches[matches.length - 1][1];
    }
    const strResult = typeof sdResult === 'object' ? JSON.stringify(sdResult) : String(sdResult);
    const pathMatches = [...strResult.matchAll(/(user\/images\/[^\s"':]+\.(?:png|jpg|jpeg|webp))/gi)];
    if (pathMatches.length > 0) return pathMatches[pathMatches.length - 1][1];
    return typeof raw === 'string' ? raw : '';
}

// ==========================================
// SLASH COMMAND 1: /drawbg (Chat Background)
// ==========================================

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'drawbg',
    aliases: ['genbg', 'bgdraw', 'paintbg'],
    returns: 'Generates an environment background image and applies it to the chat background',
    namedArgumentList: [
        SlashCommandNamedArgument.fromProps({
            name: 'card',
            description: 'Character card name or boolean flag (default: from settings)',
            typeList: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.BOOLEAN],
            isRequired: false
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'width',
            description: 'Image width (default: 1920)',
            typeList: [ARGUMENT_TYPE.NUMBER],
            isRequired: false
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'height',
            description: 'Image height (default: 1080)',
            typeList: [ARGUMENT_TYPE.NUMBER],
            isRequired: false
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'negative',
            description: 'Negative prompt additions for this generation',
            typeList: [ARGUMENT_TYPE.STRING],
            isRequired: false
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'persona',
            description: 'Include active Persona description (default: from settings)',
            typeList: [ARGUMENT_TYPE.BOOLEAN],
            isRequired: false
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'worldinfo',
            description: 'Include active World Info entries (default: from settings)',
            typeList: [ARGUMENT_TYPE.BOOLEAN],
            isRequired: false
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'messageid',
            description: 'Generate from this message ID (and prior context) instead of the most recent message',
            typeList: [ARGUMENT_TYPE.NUMBER],
            isRequired: false
        })
    ],
    unnamedArgumentList: [
        SlashCommandArgument.fromProps({
            description: 'One-off direction for the prompt generator LLM',
            typeList: [ARGUMENT_TYPE.STRING],
            isRequired: false
        })
    ],
    callback: async (args, value) => {
        const moduleSettings = getModuleSettings();
        const userInstruction = typeof value === 'string' ? value.trim() : '';
        const width = args?.width || 1920;
        const height = args?.height || 1080;
        const negativePrompt = typeof args?.negative === 'string' ? args.negative.trim() : '';
        const includePersona = parseBoolArg(args?.persona, moduleSettings.includePersona !== false);
        const includeWorldInfo = parseBoolArg(args?.worldinfo, moduleSettings.includeWorldInfo !== false);
        const rawMessageId = args?.messageid;
        const messageId = (rawMessageId !== undefined && rawMessageId !== null && rawMessageId !== '') ? Number(rawMessageId) : null;

        const { includeCharacter, targetCard } = resolveCardOption(args?.card, moduleSettings.includeCharacter);

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

            let sdCommand = `/sd quiet=true width=${width} height=${height}`;
            if (negativePrompt) sdCommand += ` negative=${quoteSlashArg(negativePrompt)}`;
            sdCommand += ` ${quoteSlashArg(finalPrompt)}`;

            const sdResult = await dispatchToSD(context, sdCommand);
            const imageUrl = extractImageUrl(sdResult);

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
    namedArgumentList: [
        SlashCommandNamedArgument.fromProps({
            name: 'card',
            description: 'Character card name or boolean flag (default: from settings)',
            typeList: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.BOOLEAN],
            isRequired: false
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'width',
            description: 'Image width (optional)',
            typeList: [ARGUMENT_TYPE.NUMBER],
            isRequired: false
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'height',
            description: 'Image height (optional)',
            typeList: [ARGUMENT_TYPE.NUMBER],
            isRequired: false
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'negative',
            description: 'Negative prompt additions for this generation',
            typeList: [ARGUMENT_TYPE.STRING],
            isRequired: false
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'persona',
            description: 'Include active Persona description (default: from settings)',
            typeList: [ARGUMENT_TYPE.BOOLEAN],
            isRequired: false
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'worldinfo',
            description: 'Include active World Info entries (default: from settings)',
            typeList: [ARGUMENT_TYPE.BOOLEAN],
            isRequired: false
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'messageid',
            description: 'Generate from this message ID (and prior context) instead of the most recent message',
            typeList: [ARGUMENT_TYPE.NUMBER],
            isRequired: false
        })
    ],
    unnamedArgumentList: [
        SlashCommandArgument.fromProps({
            description: 'One-off direction for the prompt generator LLM',
            typeList: [ARGUMENT_TYPE.STRING],
            isRequired: false
        })
    ],
    callback: async (args, value) => {
        const moduleSettings = getModuleSettings();
        const userInstruction = typeof value === 'string' ? value.trim() : '';
        const negativePrompt = typeof args?.negative === 'string' ? args.negative.trim() : '';
        const includePersona = parseBoolArg(args?.persona, moduleSettings.includePersona !== false);
        const includeWorldInfo = parseBoolArg(args?.worldinfo, moduleSettings.includeWorldInfo !== false);
        const rawMessageId = args?.messageid;
        const messageId = (rawMessageId !== undefined && rawMessageId !== null && rawMessageId !== '') ? Number(rawMessageId) : null;

        const { includeCharacter, targetCard } = resolveCardOption(args?.card, moduleSettings.includeCharacter);

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

            let sdCommand = `/sd`;
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

            const imageUrl = extractImageUrl(sdResult);

            if (typeof toastr !== 'undefined') toastr.success('Scene image requested!');

            return imageUrl || (typeof sdResult === 'string' ? sdResult : '');

        } catch (err) {
            if (typeof toastr !== 'undefined') toastr.error(`Scene image generation failed: ${err.message}`);
        }
        return '';
    },
    helpString: 'Generates a scene image in chat using /drawscene [card="Card Name"|true|false] [width=(sd default)] [height=(sd default)] [negative="..."] [persona=true|false] [worldinfo=true|false] [messageid=x] [optional direction]. messageid generates from message x (and prior context) instead of the most recent message. Returns the generated image path via {{pipe}}, so it can be chained, e.g. /drawscene | /something-else {{pipe}}.',
}));
