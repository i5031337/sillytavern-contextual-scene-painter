import { getContext } from '/scripts/extensions.js';
import { getModuleSettings, DEFAULT_TOTAL_CONTEXT_TOKEN_LIMIT } from './settings.js';

// ==========================================
// STRING & COMMAND UTILITIES
// ==========================================

export function quoteSlashArg(s) {
    return `"${String(s).replace(/"/g, '\\"')}"`;
}

// Cleans Markdown fencing or extraneous wrapping quotes returned by stubborn LLMs
export function cleanGeneratedPrompt(rawText) {
    if (!rawText) return '';
    let cleaned = rawText.trim();
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
    return (result?.pipe ?? result?.value ?? result ?? '').toString().trim();
}

// ==========================================
// TEMPORARY SETTINGS OVERRIDES
// ==========================================

export async function collectSettingsTargets(context) {
    const targets = [];
    const addTarget = (obj) => {
        if (obj && typeof obj === 'object' && !targets.includes(obj)) {
            targets.push(obj);
        }
    };

    // 1. PresetManager
    try {
        const pm = context?.getPresetManager?.() || (window.SillyTavern?.getContext?.()?.getPresetManager?.());
        if (pm) {
            addTarget(pm.getPreset?.());
            addTarget(pm.getSelectedPreset?.());
            if (pm.presets && pm.selectedPreset) {
                addTarget(pm.presets[pm.selectedPreset]);
            }
        }
    } catch (e) { /* ignore */ }

    // 2. Direct live settings references on Context
    addTarget(context?.textCompletionSettings);
    addTarget(context?.chatCompletionSettings);
    addTarget(context?.powerUserSettings);
    addTarget(context?.kaiSettings);
    addTarget(context?.kai_settings);

    // 3. Window Globals
    addTarget(window.kai_settings);
    addTarget(window.kai_presets);
    addTarget(window.horde_settings);
    addTarget(window.kobold_settings);
    addTarget(window.power_user);
    addTarget(window.selected_settings);
    addTarget(window.textgenerationwebui_settings);
    addTarget(window.textgen_settings);
    addTarget(window.openai_settings);

    // 4. Dynamic Module Imports
    try {
        const kaiMod = await import('/scripts/kai-settings.js');
        const kaiObj = kaiMod.kai_settings || kaiMod.default;
        if (kaiObj) addTarget(kaiObj);
    } catch (e) { /* ignore */ }

    try {
        const textgenMod = await import('/scripts/textgen-settings.js');
        const textgenObj = textgenMod.textgenerationwebui_settings || textgenMod.textgen_settings || textgenMod.default;
        if (textgenObj) addTarget(textgenObj);
    } catch (e) { /* ignore */ }

    try {
        const oaiMod = await import('/scripts/openai.js');
        const oaiObj = oaiMod.openai_settings || oaiMod.default;
        if (oaiObj) addTarget(oaiObj);
    } catch (e) { /* ignore */ }

    // 5. Inspect nested presets & Chat Completion preset references
    const parentObjects = [...targets];
    for (const parent of parentObjects) {
        if (!parent || typeof parent !== 'object') continue;

        if (parent.settings && typeof parent.settings === 'object') addTarget(parent.settings);
        if (parent.preset_settings && typeof parent.preset_settings === 'object') addTarget(parent.preset_settings);
        if (parent.preset_settings_openai && typeof parent.preset_settings_openai === 'object') addTarget(parent.preset_settings_openai);
        if (parent.presets && typeof parent.presets === 'object') {
            addTarget(parent.presets);
            Object.values(parent.presets).forEach(p => addTarget(p));
        }
        if (parent.params && typeof parent.params === 'object') addTarget(parent.params);

        const presetKeys = ['preset_settings_openai', 'preset_settings', 'preset', 'selected_preset', 'active_preset'];
        for (const pKey of presetKeys) {
            const presetVal = parent[pKey];
            if (presetVal !== undefined && parent[presetVal] && typeof parent[presetVal] === 'object') {
                addTarget(parent[presetVal]);
            }
            if (parent.presets && presetVal !== undefined && parent.presets[presetVal] && typeof parent.presets[presetVal] === 'object') {
                addTarget(parent.presets[presetVal]);
            }
        }
    }

    return targets;
}

export async function withTemporarySettingsOverride({ maxContext, temperature }, fn) {
    const context = getContext();
    const targets = await collectSettingsTargets(context);

    // Backup global window.max_context and DOM slider elements
    const originalWindowMaxContext = window.max_context;
    
    // Text Completion Context Slider
    const maxContextEl = $('#max_context, #max_context_slider, [name="max_context"]');
    const originalDomMaxContext = (maxContextEl.length && maxContextEl.val()) ? maxContextEl.val() : null;

    // Chat Completion Temperature Slider
    const tempOpenAiEl = $('#temp_openai, [name="temp_openai"]');
    const originalDomTempOpenAi = (tempOpenAiEl.length && tempOpenAiEl.val()) ? tempOpenAiEl.val() : null;

    // Snapshot target objects
    const backups = targets.map(obj => ({
        obj,
        max_context_length: obj.max_context_length,
        truncation_length: obj.truncation_length,
        num_ctx: obj.num_ctx,
        max_context: obj.max_context,
        temp: obj.temp,
        temperature: obj.temperature,
        temp_openai: obj.temp_openai,
        temperature_openai: obj.temperature_openai,
    }));

    try {
        if (maxContext !== undefined && maxContext !== null && maxContext > 0) {
            window.max_context = maxContext;
            if (context) {
                context.max_context = maxContext;
                context.maxContext = maxContext;
            }

            if (maxContextEl.length) {
                maxContextEl.val(maxContext).trigger('input').trigger('change');
            }
        }

        if (temperature !== undefined && temperature !== null) {
            if (tempOpenAiEl.length) {
                tempOpenAiEl.val(temperature).trigger('input').trigger('change');
            }
        }

        targets.forEach(obj => {
            if (maxContext !== undefined && maxContext !== null && maxContext > 0) {
                obj.max_context_length = maxContext;
                obj.truncation_length = maxContext;
                obj.num_ctx = maxContext;
                obj.max_context = maxContext;
            }

            if (temperature !== undefined && temperature !== null) {
                obj.temp = temperature;
                obj.temperature = temperature;
                obj.temp_openai = temperature;
                obj.temperature_openai = temperature;
            }
        });

        console.debug('[scene-painter] Applied temporary parameter overrides:', { maxContext, temperature, targetsCount: targets.length });

        return await fn();
    } finally {
        // Restore globals
        if (originalWindowMaxContext !== undefined) {
            window.max_context = originalWindowMaxContext;
        }

        // Restore DOM sliders
        if (maxContextEl.length && originalDomMaxContext !== null) {
            maxContextEl.val(originalDomMaxContext).trigger('input').trigger('change');
        }

        if (tempOpenAiEl.length && originalDomTempOpenAi !== null) {
            tempOpenAiEl.val(originalDomTempOpenAi).trigger('input').trigger('change');
        }

        // Restore target objects
        backups.forEach(({ obj, max_context_length, truncation_length, num_ctx, max_context, temp, temperature, temp_openai, temperature_openai }) => {
            if (max_context_length !== undefined) obj.max_context_length = max_context_length;
            if (truncation_length !== undefined) obj.truncation_length = truncation_length;
            if (num_ctx !== undefined) obj.num_ctx = num_ctx;
            if (max_context !== undefined) obj.max_context = max_context;

            if (temp !== undefined) obj.temp = temp;
            if (temperature !== undefined) obj.temperature = temperature;
            if (temp_openai !== undefined) obj.temp_openai = temp_openai;
            if (temperature_openai !== undefined) obj.temperature_openai = temperature_openai;
        });

        console.debug('[scene-painter] Restored original preset parameters.');
    }
}

// ==========================================
// RAW LLM GENERATION CALLS
// ==========================================

export async function executeRawGeneration(context, fullRawPrompt) {
    const moduleSettings = getModuleSettings();
    const responseLength = Number(moduleSettings.genMaxResponse) > 0 ? Number(moduleSettings.genMaxResponse) : null;
    const promptBudget = Number(moduleSettings.totalContextTokenLimit) > 0 ? Number(moduleSettings.totalContextTokenLimit) : DEFAULT_TOTAL_CONTEXT_TOKEN_LIMIT;
    
    // Calculate API context size = Prompt Budget + Response Tokens
    const apiContextSize = promptBudget + (responseLength || 300);

    const tempOverride = (moduleSettings.genTemperature !== null && moduleSettings.genTemperature !== undefined && moduleSettings.genTemperature !== '')
        ? Number(moduleSettings.genTemperature)
        : null;
    const validTemp = Number.isFinite(tempOverride) ? tempOverride : null;

    const customSettings = {
        max_context_length: apiContextSize,
        truncation_length: apiContextSize,
        num_ctx: apiContextSize,
        max_context: apiContextSize,
        max_length: responseLength || 300,
    };

    if (validTemp !== null) {
        customSettings.temperature = validTemp;
        customSettings.temp = validTemp;
    }

    const generateOptions = {
        prompt: fullRawPrompt,
        api: null,
        instructOverride: false,
        quietToLoud: false,
        systemPrompt: '',
        responseLength: responseLength,
        max_context_length: apiContextSize,
        truncation_length: apiContextSize,
        num_ctx: apiContextSize,
        max_context: apiContextSize,
        temperature: validTemp,
        temp: validTemp,
        custom_settings: customSettings,
        custom_generate_settings: customSettings,
        gen_settings: customSettings
    };

    return await withTemporarySettingsOverride({
        maxContext: apiContextSize,
        temperature: validTemp
    }, async () => {
        let raw;
        try {
            raw = await context.generateRaw(generateOptions);
        } catch (err) {
            // Fallback for older positional ST signature
            raw = await context.generateRaw(
                fullRawPrompt,
                null,
                false,
                false,
                '',
                responseLength,
                customSettings
            );
        }
        return cleanGeneratedPrompt(raw);
    });
}

export async function generateWithOptionalProfile(context, fullRawPrompt) {
    const moduleSettings = getModuleSettings();
    const profileName = (moduleSettings.connectionProfile || '').trim();
    if (!profileName) {
        return await executeRawGeneration(context, fullRawPrompt);
    }

    const runTask = async () => {
        let previousProfile = null;
        try {
            previousProfile = await readActiveProfileName(context);
            console.debug(`[scene-painter] Active profile before switch: "${previousProfile || '(none)'}"`);
        } catch (err) {
            console.warn('[scene-painter] Could not read active profile -- will not attempt to restore afterward:', err);
        }

        try {
            await context.executeSlashCommands(`/profile ${quoteSlashArg(profileName)}`);
            console.debug(`[scene-painter] Switched profile to "${profileName}", generating...`);
            const result = await executeRawGeneration(context, fullRawPrompt);
            console.debug(`[scene-painter] Generation via "${profileName}" complete.`);
            return result;
        } finally {
            if (previousProfile !== null && previousProfile.toLowerCase() !== profileName.toLowerCase()) {
                const restoreTarget = previousProfile === '' ? 'None' : previousProfile;
                try {
                    await context.executeSlashCommands(`/profile ${quoteSlashArg(restoreTarget)}`);

                    const nowActive = await readActiveProfileName(context);
                    const restoredOk = nowActive.toLowerCase() === restoreTarget.toLowerCase()
                        || (restoreTarget === 'None' && !nowActive);
                    if (!restoredOk) {
                        console.warn(`[scene-painter] Profile restore did not take effect as expected. Wanted "${restoreTarget}", ST now reports "${nowActive || '(none)'}". The alternate profile may still be active.`);
                    } else {
                        console.debug(`[scene-painter] Profile restored to "${restoreTarget}".`);
                    }
                } catch (err) {
                    console.warn(`[scene-painter] Failed to restore profile "${previousProfile}":`, err);
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
        list.push(relativePath);
        chatMetadata['chat_backgrounds'] = list;
        chatMetadata['custom_background'] = cssUrl;

        if (typeof context.saveMetadata === 'function') {
            await context.saveMetadata();
        }

        $('#bg1').css('background-image', cssUrl);

        if (typeof toastr !== 'undefined') toastr.success('Background generated and applied to this chat!');
    } catch (err) {
        if (typeof toastr !== 'undefined') toastr.error(`Failed to apply background: ${err.message}`);
    }
}
