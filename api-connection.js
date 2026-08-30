import { getContext } from '/scripts/extensions.js';
import { eventSource, event_types } from '/script.js';
import { getModuleSettings } from '../settings.js';

// ==========================================
// STRING & COMMAND UTILITIES
// ==========================================

export function quoteSlashArg(s) {
    return `"${String(s).replace(/"/g, '\\"')}"`;
}

// Cleans Markdown fencing or extraneous wrapping quotes returned by LLMs
export function cleanGeneratedPrompt(rawText) {
    if (!rawText) return '';
    let cleaned = String(rawText).trim();
    cleaned = cleaned.replace(/^```[\w-]*\s*/i, '').replace(/\s*```$/i, '');
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1).trim();
    }
    return cleaned;
}

// ==========================================
// PROFILE MANAGEMENT & PROMISE QUEUE
// ==========================================

let profileSwitchQueue = Promise.resolve();

export async function readActiveProfileName(context) {
    const result = await context.executeSlashCommands('/profile');
    const profile = (result?.pipe ?? result?.value ?? result ?? '').toString().trim();
    return profile === 'None' ? '' : profile;
}

// ==========================================
// RAW LLM GENERATION CALLS
// ==========================================

export async function executeRawGeneration(context, { prompt = '', systemPrompt = '' } = {}) {
    const moduleSettings = getModuleSettings();
    const responseLength = Number(moduleSettings.genMaxResponse) > 0 ? Number(moduleSettings.genMaxResponse) : null;
    const tempOverride = (moduleSettings.genTemperature !== null && moduleSettings.genTemperature !== undefined && moduleSettings.genTemperature !== '')
        ? Number(moduleSettings.genTemperature)
        : null;
    const validTemp = Number.isFinite(tempOverride) ? tempOverride : null;

    let tempHook = null;
    if (validTemp !== null && eventSource && event_types?.CHAT_COMPLETION_SETTINGS_READY) {
        tempHook = (data) => {
            if (data && typeof data === 'object') {
                data.temperature = validTemp;
            }
        };
        eventSource.once(event_types.CHAT_COMPLETION_SETTINGS_READY, tempHook);
    }

    try {
        const raw = await context.generateRaw({
            prompt,
            systemPrompt,
            responseLength,
            trimNames: false,
        });
        return cleanGeneratedPrompt(raw);
    } finally {
        if (tempHook && eventSource && event_types?.CHAT_COMPLETION_SETTINGS_READY) {
            eventSource.removeListener(event_types.CHAT_COMPLETION_SETTINGS_READY, tempHook);
        }
    }
}

export async function generateWithOptionalProfile(context, { prompt = '', systemPrompt = '' } = {}) {
    const moduleSettings = getModuleSettings();
    const profileName = (moduleSettings.connectionProfile || '').trim();
    if (!profileName) {
        return await executeRawGeneration(context, { prompt, systemPrompt });
    }

    const runTask = async () => {
        let previousProfile = null;
        try {
            previousProfile = await readActiveProfileName(context);
            console.debug(`[api-connection] Active profile before switch: "${previousProfile || '(none)'}"`);
        } catch (err) {
            console.warn('[api-connection] Could not read active profile -- will not attempt to restore afterward:', err);
        }

        try {
            await context.executeSlashCommands(`/profile ${quoteSlashArg(profileName)}`);
            console.debug(`[api-connection] Switched profile to "${profileName}", generating...`);
            const result = await executeRawGeneration(context, { prompt, systemPrompt });
            console.debug(`[api-connection] Generation via "${profileName}" complete.`);
            return result;
        } finally {
            if (previousProfile !== null && previousProfile.toLowerCase() !== profileName.toLowerCase()) {
                const restoreTarget = previousProfile === '' ? 'None' : previousProfile;
                try {
                    await context.executeSlashCommands(`/profile ${quoteSlashArg(restoreTarget)}`);
                    const nowActive = await readActiveProfileName(context);
                    console.debug(`[api-connection] Profile restored to "${restoreTarget}" (active: "${nowActive || '(none)'}").`);
                } catch (err) {
                    console.warn(`[api-connection] Failed to restore profile "${previousProfile}":`, err);
                }
            }
        }
    };

    const result = profileSwitchQueue.then(runTask, runTask);
    profileSwitchQueue = result.then(() => {}, () => {});
    return result;
}

// ==========================================
// STABLE DIFFUSION & BACKGROUND APIS
// ==========================================

export async function dispatchToSD(context, sdCommand) {
    const moduleSettings = getModuleSettings();
    if (moduleSettings.disableFreeExtend !== false && !/\bextend=/.test(sdCommand)) {
        sdCommand = sdCommand.replace(/^\/sd\b/, '/sd extend=false');
    }
    return await context.executeSlashCommands(sdCommand);
}

export async function uploadAndSetBackground(imageUrl) {
    try {
        const relativePath = imageUrl.replace(/^\/+/, '');
        const cssUrl = `url("${relativePath}")`;

        const context = getContext();
        const chatMetadata = context.chatMetadata;
        const list = Array.isArray(chatMetadata['chat_backgrounds']) ? chatMetadata['chat_backgrounds'] : [];
        if (!list.includes(relativePath)) {
            list.push(relativePath);
        }
        chatMetadata['chat_backgrounds'] = list;
        chatMetadata['custom_background'] = cssUrl;

        if (typeof context.saveMetadataDebounced === 'function') {
            context.saveMetadataDebounced();
        } else if (typeof context.saveMetadata === 'function') {
            await context.saveMetadata();
        }

        $('#bg1').css('background-image', cssUrl);

        if (typeof toastr !== 'undefined') toastr.success('Background generated and applied to this chat!');
    } catch (err) {
        if (typeof toastr !== 'undefined') toastr.error(`Failed to apply background: ${err.message}`);
    }
}
