import { getContext } from '/scripts/extensions.js';
import { getModuleSettings, defaultCommandSettings, DEFAULT_HISTORY_TOKEN_LIMIT, DEFAULT_TOTAL_CONTEXT_TOKEN_LIMIT } from './settings.js';
import { generateWithOptionalProfile } from './api-connection.js';

// ==========================================
// CHARACTER & MACRO UTILITIES
// ==========================================

export function resolveCharacterIndex(cardName) {
    if (!cardName) return null;
    const context = getContext();
    const characters = context.characters || [];
    const search = cardName.toLowerCase();

    // 1. Exact name match
    let idx = characters.findIndex(c => c?.name?.toLowerCase() === search);
    if (idx !== -1) return idx;

    // 2. Exact avatar filename match (with or without extension)
    idx = characters.findIndex(c => {
        const avatar = c?.avatar?.toLowerCase() || '';
        return avatar === search || avatar === `${search}.png`;
    });
    if (idx !== -1) return idx;

    // 3. Substring match, but only if it's unambiguous
    const matches = characters
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c?.name?.toLowerCase().includes(search) || c?.avatar?.toLowerCase().includes(search));

    return matches.length === 1 ? matches[0].i : null;
}

export function replaceMacros(text, charName = '', userName = '') {
    if (!text) return '';
    return text
        .replace(/{{char}}/gi, () => charName)
        .replace(/{{user}}/gi, () => userName);
}

export function sanitizePromptForSlashCommand(promptText) {
    if (!promptText) return '';
    return promptText
        .replace(/\{\{/g, '{ {')  // Break macro syntax so LLM output can't trigger ST macros
        .replace(/\}\}/g, '} }')
        .replace(/\|/g, ',')      // Prevent pipe command chaining
        .replace(/\r?\n+/g, ' ')  // Collapse linebreaks
        .replace(/\s+/g, ' ')     // Collapse whitespace
        .trim();
}

export function parseBoolArg(value, defaultValue) {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    return defaultValue;
}

// ==========================================
// TOKENIZATION & CONTEXT EXTRACTION
// ==========================================

let tokenizerModule = null;
export async function getTokenizer() {
    if (!tokenizerModule) {
        try {
            tokenizerModule = await import('/scripts/tokenizers.js');
        } catch (e) { /* fallback */ }
    }
    return tokenizerModule;
}

export async function countTokens(text) {
    if (!text) return 0;
    const tok = await getTokenizer();
    if (tok?.getTokenCountAsync) return await tok.getTokenCountAsync(text);
    if (tok?.getTokenCount) return tok.getTokenCount(text);
    return Math.ceil(text.length / 4);
}

export async function buildRecentMessagesBlock(chatLog, userName, tokenLimit) {
    const limit = Number(tokenLimit) > 0 ? Number(tokenLimit) : DEFAULT_HISTORY_TOKEN_LIMIT;
    const lines = [];
    let usedTokens = 0;

    for (let i = chatLog.length - 1; i >= 0; i--) {
        const m = chatLog[i];
        if (!m || m.is_system || m.is_hidden || !m.mes?.trim()) continue;

        const line = `${m.is_user ? userName : m.name}: ${m.mes}`;
        const lineTokens = await countTokens(line);

        if (lines.length > 0 && usedTokens + lineTokens > limit) break;

        lines.unshift(line);
        usedTokens += lineTokens;

        if (usedTokens >= limit) break;
    }

    return lines.join('\n');
}

export async function getActivePersonaDescription() {
    try {
        const puModule = await import('/scripts/power-user.js');
        const desc = puModule?.power_user?.persona_description;
        return typeof desc === 'string' ? desc.trim() : '';
    } catch (err) {
        return '';
    }
}

// ==========================================
// PROMPT ASSEMBLY & SYNTHESIS
// ==========================================

/**
 * @typedef {object} BuildImagePromptOptions
 * @property {boolean} [includePersona] Whether to include persona description
 * @property {boolean} [includeWorldInfo] Whether to include World Info / Lore
 * @property {boolean} [includeCharacter] Whether to include character details
 * @property {number|null} [messageId] Specific message ID to anchor history to
 */

/**
 * Builds the full LLM image generation prompt.
 * @param {string} [userInstruction='']
 * @param {string} [targetCard='']
 * @param {'genbg'|'gencustom'} [commandKey='gencustom']
 * @param {BuildImagePromptOptions} [options={}]
 * @returns {Promise<string>}
 */
export async function buildImagePrompt(userInstruction = '', targetCard = '', commandKey = 'gencustom', options = {}) {
    const moduleSettings = getModuleSettings();
    const {
        includePersona = moduleSettings.includePersona !== false,
        includeWorldInfo = moduleSettings.includeWorldInfo !== false,
        includeCharacter = moduleSettings.includeCharacter !== false,
        messageId = null
    } = options;

    const context = getContext();
    const defaults = defaultCommandSettings(commandKey, 'natural');
    const commandSettings = moduleSettings[commandKey] || defaults;

    // Calculate budget ceilings early so World Info can use the context setting
    const totalBudget = Number(moduleSettings.totalContextTokenLimit) > 0
        ? Number(moduleSettings.totalContextTokenLimit)
        : DEFAULT_TOTAL_CONTEXT_TOKEN_LIMIT;
    const historyCeiling = Number(moduleSettings.historyTokenLimit) > 0
        ? Number(moduleSettings.historyTokenLimit)
        : DEFAULT_HISTORY_TOKEN_LIMIT;
    
    const promptInstruction = commandSettings.promptInstruction || defaults.promptInstruction;
    let systemPrompt = commandSettings.systemPrompt || defaults.systemPrompt;

    let charIdx = null;
    if (includeCharacter) {
        if (targetCard) {
            charIdx = resolveCharacterIndex(targetCard);
        } else {
            const activeIdx = (context.characterId !== undefined && context.characterId !== null) ? Number(context.characterId) : null;
            if (activeIdx !== null && activeIdx >= 0 && context.characters?.[activeIdx]) {
                charIdx = activeIdx;
            }
        }
    }

    const userName = context.name1 || 'User';

    const fullChatLog = context.chat || [];
    let chatLog = fullChatLog;
    if (messageId !== null && messageId !== undefined) {
        const idx = Number(messageId);
        if (!Number.isInteger(idx) || idx < 0 || idx >= fullChatLog.length) {
            throw new Error(`Invalid messageid ${messageId}. Must be an integer between 0 and ${fullChatLog.length - 1}.`);
        }
        chatLog = fullChatLog.slice(0, idx + 1);
    }

    let wiText = '';
    if (includeWorldInfo) {
        try {
            let getWorldInfoPrompt = window.getWorldInfoPrompt;
            if (typeof getWorldInfoPrompt !== 'function') {
                const wiModule = await import('/scripts/world-info.js');
                getWorldInfoPrompt = wiModule?.getWorldInfoPrompt || wiModule?.default;
            }

            if (typeof getWorldInfoPrompt === 'function') {
                const chatStrings = chatLog
                    .filter(m => m && !m.is_system && !m.is_hidden)
                    .map(m => `${m.name}: ${m.mes}`);
                    
                const wiResult = await getWorldInfoPrompt(chatStrings, totalBudget, true);
                if (typeof wiResult === 'string') {
                    wiText = wiResult;
                } else if (wiResult && typeof wiResult === 'object') {
                    wiText = wiResult.worldInfoString || wiResult.worldInfoPrompt || wiResult.format || '';
                }
            }
        } catch (err) {
            console.warn('[scene-painter] Could not load World Info:', err);
        }
    }

    let targetCharName = '';
    if (charIdx !== null && context.characters?.[charIdx]) {
        targetCharName = context.characters[charIdx]?.name || '';
    }

    let personaText = '';
    if (includePersona) {
        const personaDescription = await getActivePersonaDescription();
        if (personaDescription) {
            personaText = replaceMacros(personaDescription, targetCharName, userName);
        }
    }

    const specificRequestBlock = userInstruction
        ? `<specific_request>\n${userInstruction}\n</specific_request>\n\n`
        : '';
    const effectiveInstruction = userInstruction
        ? `Focus specifically on the request in <specific_request>: "${userInstruction}". Use the scene/world context to figure out exactly who or what that refers to. ${promptInstruction}`
        : promptInstruction;

    let fixedPromptHead = '';
    let fixedPromptTail = '';

    if (charIdx !== null && context.characters?.[charIdx]) {
        const targetCharacter = context.characters[charIdx];

        fixedPromptHead += `<target_character>\n`;
        fixedPromptHead += `  <name>${targetCharName}</name>\n`;
        if (targetCharacter.description) {
            fixedPromptHead += `  <description>${replaceMacros(targetCharacter.description, targetCharName, userName)}</description>\n`;
        }
        if (targetCharacter.personality) {
            fixedPromptHead += `  <personality>${replaceMacros(targetCharacter.personality, targetCharName, userName)}</personality>\n`;
        }
        if (targetCharacter.scenario) {
            fixedPromptHead += `  <scenario>${replaceMacros(targetCharacter.scenario, targetCharName, userName)}</scenario>\n`;
        }
        fixedPromptHead += `</target_character>\n\n`;

        if (personaText) fixedPromptHead += `<user_persona>\n  <name>${userName}</name>\n${personaText}\n</user_persona>\n\n`;
        if (wiText) fixedPromptHead += `<world_lore>\n${wiText}\n</world_lore>\n\n`;

        fixedPromptTail += specificRequestBlock;
        fixedPromptTail += `<instruction>\n${effectiveInstruction}\n</instruction>\n\n`;

        if (targetCharacter.post_history_instructions) {
            fixedPromptTail += `<post_history_instructions>\n${replaceMacros(targetCharacter.post_history_instructions, targetCharName, userName)}\n</post_history_instructions>`;
        }
    } else {
        if (personaText) fixedPromptHead += `<user_persona>\n  <name>${userName}</name>\n${personaText}\n</user_persona>\n\n`;
        if (wiText) fixedPromptHead += `<world_lore>\n${wiText}\n</world_lore>\n\n`;

        fixedPromptTail += specificRequestBlock;
        fixedPromptTail += `<instruction>\n${effectiveInstruction}\n</instruction>`;
    }

    const fixedTokens = await countTokens(systemPrompt) + await countTokens(fixedPromptHead) + await countTokens(fixedPromptTail)
        + await countTokens('<recent_scene>\n\n</recent_scene>\n\n');
    const availableForHistory = Math.max(0, totalBudget - fixedTokens);
    const historyBudget = Math.min(historyCeiling, availableForHistory);

    if (fixedTokens >= totalBudget) {
        console.warn(`[scene-painter] Fixed prompt content (system prompt + character/persona/lore/instructions) alone is ~${fixedTokens} tokens, at or over the Total Prompt Token Budget of ${totalBudget}. Chat history will be omitted; consider raising the budget or trimming lore/persona.`);
        if (typeof toastr !== 'undefined') {
            toastr.warning(`Character/lore/persona content alone is ~${fixedTokens} tokens -- at or over your Total Prompt Token Budget (${totalBudget}). No room left for chat history this generation.`);
        }
    }

    const recentMessages = await buildRecentMessagesBlock(chatLog, userName, historyBudget);

    const userPrompt = fixedPromptHead
        + `<recent_scene>\n${recentMessages}\n</recent_scene>\n\n`
        + fixedPromptTail;

    const fullRawPrompt = `<system_prompt>\n${systemPrompt}\n</system_prompt>\n\n<user_prompt>\n${userPrompt}\n</user_prompt>`;

    const totalTokens = fixedTokens + await countTokens(recentMessages);
    if (totalTokens > totalBudget) {
        console.warn(`[scene-painter] Assembled prompt is ~${totalTokens} tokens, over the Total Prompt Token Budget of ${totalBudget}.`);
    }

    return await generateWithOptionalProfile(context, fullRawPrompt);
}
