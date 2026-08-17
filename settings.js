import { getContext, extension_settings } from '/scripts/extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '/script.js';
import { callGenericPopup, POPUP_TYPE } from '/scripts/popup.js';

// ==========================================
// DEFAULT PROMPTS & TOKEN CONSTANTS
// ==========================================

// Background-focused prompts (/drawbg or /genbg) -- natural-language style (advanced text-encoder models)
export const DEFAULT_GENBG_SYSTEM_PROMPT = 'You are an expert AI image prompt engineer specializing in cinematic environment art, mecha, architecture, landscape design, and visual background scene building for storytelling.';
export const DEFAULT_GENBG_PROMPT_INSTRUCTION = 'Synthesize the provided location, lore, and recent story context into a detailed, immersive image prompt focused on the environment. Describe the setting, atmosphere, lighting, camera perspective/framing, weather, textures, and mood. Exclude speech bubbles, text overlays, and main character portrait details. Output ONLY the raw image prompt text with no conversational intro, quotes, markdown wrappers, or explanation.';

// Scene/Character-focused prompts (/drawscene or /gencustom) -- natural-language style
export const DEFAULT_GENCUSTOM_SYSTEM_PROMPT = 'You are an expert AI image prompt engineer specializing in visual narrative illustration, character design, cinematic framing, and story scene composition.';
export const DEFAULT_GENCUSTOM_PROMPT_INSTRUCTION = 'Synthesize the provided character information, scene context, and recent actions into a vivid image prompt capturing this exact narrative moment. Describe the subject(s), dynamic poses, facial expressions, attire, scene framing, focal elements, lighting, and surrounding environment. Output ONLY the raw image prompt text with no conversational intro, quotes, markdown wrappers, or explanation.';

// Background-focused prompts -- Danbooru/booru tag style (SDXL and similar tag-trained models)
export const DEFAULT_GENBG_SYSTEM_PROMPT_TAGS = 'You are an expert Stable Diffusion prompt engineer who writes Danbooru-style booru tag lists for environment, architecture, and background scene art.';
export const DEFAULT_GENBG_PROMPT_INSTRUCTION_TAGS = 'Synthesize the provided location, lore, and recent story context into a comma-separated list of Danbooru-style booru tags describing the environment. Cover setting/location, time of day, lighting, weather, architecture or terrain, color palette, and camera framing (e.g. wide shot, from above, no humans). Do not include characters, speech bubbles, or text. Output ONLY the raw comma-separated tag list in lowercase, with no numbering, headers, markdown, or explanation.';

// Scene/Character-focused prompts -- Danbooru/booru tag style
export const DEFAULT_GENCUSTOM_SYSTEM_PROMPT_TAGS = 'You are an expert Stable Diffusion prompt engineer who writes Danbooru-style booru tag lists for character and narrative scene art.';
export const DEFAULT_GENCUSTOM_PROMPT_INSTRUCTION_TAGS = 'Synthesize the provided character information, scene context, and recent actions into a comma-separated list of Danbooru-style booru tags capturing this exact narrative moment. Cover subject count (e.g. 1girl, 1boy), pose/action, expression, clothing/attire, framing/shot type, setting, and lighting. Output ONLY the raw comma-separated tag list in lowercase, with no numbering, headers, markdown, or explanation.';

export const DEFAULT_HISTORY_TOKEN_LIMIT = 2048;
export const DEFAULT_TOTAL_CONTEXT_TOKEN_LIMIT = 8192;

export let moduleSettings = {};
export let refreshConnectionProfilesDropdown = null;

export function getModuleSettings() {
    return moduleSettings;
}

export function defaultCommandSettings(commandKey = 'genbg', promptStyle = 'natural') {
    const useTags = promptStyle === 'tags';
    if (commandKey === 'gencustom') {
        return {
            systemPrompt: useTags ? DEFAULT_GENCUSTOM_SYSTEM_PROMPT_TAGS : DEFAULT_GENCUSTOM_SYSTEM_PROMPT,
            promptInstruction: useTags ? DEFAULT_GENCUSTOM_PROMPT_INSTRUCTION_TAGS : DEFAULT_GENCUSTOM_PROMPT_INSTRUCTION,
        };
    }
    return {
        systemPrompt: useTags ? DEFAULT_GENBG_SYSTEM_PROMPT_TAGS : DEFAULT_GENBG_SYSTEM_PROMPT,
        promptInstruction: useTags ? DEFAULT_GENBG_PROMPT_INSTRUCTION_TAGS : DEFAULT_GENBG_PROMPT_INSTRUCTION,
    };
}

export function isEditPromptEnabled() {
    if (moduleSettings.forceEdit) return true;
    const context = getContext();
    return !!context.extension_settings?.sd?.refine_mode;
}

export function tightenPromptPopupLayout() {
    const observer = new MutationObserver((_mutations, obs) => {
        const textarea = document.querySelector('.popup-content textarea, dialog.popup textarea');
        if (!textarea) return;

        const container = textarea.parentElement;
        if (container) {
            container.style.setProperty('display', 'flex', 'important');
            container.style.setProperty('flex-direction', 'column', 'important');
            container.style.setProperty('justify-content', 'flex-start', 'important');
            container.style.setProperty('align-items', 'stretch', 'important');
            container.style.setProperty('height', 'auto', 'important');
            container.style.setProperty('min-height', '0', 'important');
            container.style.setProperty('gap', '4px', 'important');
        }
        let sibling = textarea.previousElementSibling;
        while (sibling) {
            sibling.style.setProperty('margin-bottom', '4px', 'important');
            sibling.style.setProperty('padding-bottom', '0px', 'important');
            sibling.style.setProperty('flex', '0 0 auto', 'important');
            sibling = sibling.previousElementSibling;
        }

        textarea.style.setProperty('flex', '0 0 auto', 'important');
        textarea.style.setProperty('max-height', '45vh', 'important');
        textarea.style.setProperty('overflow-y', 'auto', 'important');

        obs.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 5000);
}

export async function promptUserForEdit(currentPrompt) {
    try {
        const popupPromise = callGenericPopup(
            'Review and edit the prompt before generation:',
            POPUP_TYPE.INPUT,
            currentPrompt,
            { rows: 8, wide: true, okButton: 'Generate', cancelButton: 'Cancel' }
        );

        tightenPromptPopupLayout();
        const result = await popupPromise;
        return typeof result === 'string' ? result : null;
    } catch (err) {
        return window.prompt('Edit Image Prompt:', currentPrompt);
    }
}

export function initExtensionSettings() {
    if (document.getElementById('custom_bg_gen_container')) return;

    const context = getContext();

    // 1. Initialize default settings in ST extension_settings store
    if (!extension_settings.customBgGen) {
        extension_settings.customBgGen = {
            genbg: defaultCommandSettings('genbg', 'natural'),
            gencustom: defaultCommandSettings('gencustom', 'natural'),
            forceEdit: true,
            connectionProfile: '',
            genMaxResponse: 0,
            genTemperature: null,
            disableFreeExtend: true,
            includeCharacter: true,
            includePersona: true,
            includeWorldInfo: true,
            historyTokenLimit: DEFAULT_HISTORY_TOKEN_LIMIT,
            totalContextTokenLimit: DEFAULT_TOTAL_CONTEXT_TOKEN_LIMIT,
            genbgPresets: [],
            gencustomPresets: [],
        };
    }
    moduleSettings = extension_settings.customBgGen;

    // Clean up legacy settings keys
    if (moduleSettings.presetName !== undefined) delete moduleSettings.presetName;
    if (moduleSettings.genMaxContext !== undefined) delete moduleSettings.genMaxContext;
    if (moduleSettings.promptStyle !== undefined) delete moduleSettings.promptStyle;

    // Migrate old prompt settings if upgrading
    if (typeof moduleSettings.systemPrompt === 'string' || typeof moduleSettings.promptInstruction === 'string') {
        const migratedGenbg = {
            systemPrompt: moduleSettings.systemPrompt || DEFAULT_GENBG_SYSTEM_PROMPT,
            promptInstruction: moduleSettings.promptInstruction || DEFAULT_GENBG_PROMPT_INSTRUCTION,
        };
        const migratedGencustom = {
            systemPrompt: moduleSettings.systemPrompt || DEFAULT_GENCUSTOM_SYSTEM_PROMPT,
            promptInstruction: moduleSettings.promptInstruction || DEFAULT_GENCUSTOM_PROMPT_INSTRUCTION,
        };
        if (!moduleSettings.genbg) moduleSettings.genbg = { ...migratedGenbg };
        if (!moduleSettings.gencustom) moduleSettings.gencustom = { ...migratedGencustom };
        delete moduleSettings.systemPrompt;
        delete moduleSettings.promptInstruction;
    }

    if (Array.isArray(moduleSettings.presets) && !moduleSettings.genbgPresets && !moduleSettings.gencustomPresets) {
        moduleSettings.genbgPresets = [...moduleSettings.presets];
        delete moduleSettings.presets;
    }

    if (!moduleSettings.genbg) moduleSettings.genbg = defaultCommandSettings('genbg', 'natural');
    if (!moduleSettings.gencustom) moduleSettings.gencustom = defaultCommandSettings('gencustom', 'natural');
    if (typeof moduleSettings.connectionProfile !== 'string') moduleSettings.connectionProfile = '';
    
    if (!Number.isFinite(Number(moduleSettings.genMaxResponse))) moduleSettings.genMaxResponse = 0;
    if (moduleSettings.genTemperature !== null && !Number.isFinite(Number(moduleSettings.genTemperature))) {
        moduleSettings.genTemperature = null;
    }

    if (typeof moduleSettings.disableFreeExtend !== 'boolean') moduleSettings.disableFreeExtend = true;
    if (typeof moduleSettings.includeCharacter !== 'boolean') moduleSettings.includeCharacter = true;
    if (typeof moduleSettings.includePersona !== 'boolean') moduleSettings.includePersona = true;
    if (typeof moduleSettings.includeWorldInfo !== 'boolean') moduleSettings.includeWorldInfo = true;

    if (!Number.isFinite(Number(moduleSettings.historyTokenLimit)) || Number(moduleSettings.historyTokenLimit) <= 0) {
        moduleSettings.historyTokenLimit = DEFAULT_HISTORY_TOKEN_LIMIT;
    }
    if (!Number.isFinite(Number(moduleSettings.totalContextTokenLimit)) || Number(moduleSettings.totalContextTokenLimit) <= 0) {
        moduleSettings.totalContextTokenLimit = DEFAULT_TOTAL_CONTEXT_TOKEN_LIMIT;
    }
    if (!Array.isArray(moduleSettings.genbgPresets)) moduleSettings.genbgPresets = [];
    if (!Array.isArray(moduleSettings.gencustomPresets)) moduleSettings.gencustomPresets = [];

    // 2. Inject UI into SillyTavern extension settings panel
    const settingsHtml = `
        <div id="custom_bg_gen_container" class="extension_container">
            <div id="custom_bg_gen_settings">
                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>Contextual Scene Painter</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                        <!-- Background Presets -->
                        <h4 style="margin-bottom: 4px;">Background Presets (/drawbg)</h4>
                        <div style="display: flex; gap: 5px; margin-bottom: 10px; align-items: center;">
                            <select id="custom_bg_genbg_preset_select" class="text_pole" style="flex: 1;"></select>
                        </div>
                        <div style="display: flex; gap: 5px; margin-bottom: 10px;">
                            <button id="custom_bg_genbg_preset_load" class="menu_button">Load</button>
                            <button id="custom_bg_genbg_preset_save" class="menu_button">Save</button>
                            <button id="custom_bg_genbg_preset_delete" class="menu_button fa-solid fa-trash" style="flex: 0 0 auto; color: red;" title="Delete selected preset"></button>
                        </div>

                        <!-- Command Settings Fields -->
                        <h4 style="margin-bottom: 4px;">Background Settings</h4>
                        <label>System Prompt Override</label>
                        <textarea id="custom_bg_genbg_system_prompt" class="text_pole" rows="2" style="width:100%; resize:vertical; margin-bottom:10px;"></textarea>
                        <label>Prompt Instruction</label>
                        <textarea id="custom_bg_genbg_prompt_instruction" class="text_pole" rows="4" style="width:100%; resize:vertical; margin-bottom:10px;"></textarea>

                        <hr>

                        <!-- Scene Presets -->
                        <h4 style="margin-bottom: 4px;">Scene Presets (/drawscene)</h4>
                        <div style="display: flex; gap: 5px; margin-bottom: 10px; align-items: center;">
                            <select id="custom_bg_gencustom_preset_select" class="text_pole" style="flex: 1;"></select>
                        </div>
                        <div style="display: flex; gap: 5px; margin-bottom: 10px;">
                            <button id="custom_bg_gencustom_preset_load" class="menu_button">Load</button>
                            <button id="custom_bg_gencustom_preset_save" class="menu_button">Save</button>
                            <button id="custom_bg_gencustom_preset_delete" class="menu_button fa-solid fa-trash" style="flex: 0 0 auto; color: red;" title="Delete selected preset"></button>
                        </div>

                        <h4 style="margin-bottom: 4px;">Scene Settings</h4>
                        <label>System Prompt Override</label>
                        <textarea id="custom_bg_gencustom_system_prompt" class="text_pole" rows="2" style="width:100%; resize:vertical; margin-bottom:10px;"></textarea>
                        <label>Prompt Instruction</label>
                        <textarea id="custom_bg_gencustom_prompt_instruction" class="text_pole" rows="4" style="width:100%; resize:vertical; margin-bottom:10px;"></textarea>

                        <hr>

                        <h4 style="margin-bottom: 4px;">Default Context Inclusion</h4>
                        <label class="checkbox_label" title="Include active Character card details by default when no specific card argument is passed.">
                            <input type="checkbox" id="custom_bg_include_character" />
                            <span>Include Character Details by Default</span>
                        </label>

                        <label class="checkbox_label" title="Include active User Persona description by default.">
                            <input type="checkbox" id="custom_bg_include_persona" />
                            <span>Include User Persona by Default</span>
                        </label>

                        <label class="checkbox_label" title="Include active World Info / Lorebook entries by default.">
                            <input type="checkbox" id="custom_bg_include_world_info" />
                            <span>Include World Info / Lore by Default</span>
                        </label>

                        <hr>

                        <label title="Maximum number of tokens of recent chat history to feed into prompt generation. Independent of active character context limits.">Chat History Token Limit (ceiling within total prompt budget)</label>
                        <input type="number" id="custom_bg_history_token_limit" class="text_pole" min="1" step="1" style="width:100%; margin-bottom:10px;" />

                        <label title="Target token ceiling for the input prompt context (system prompt + character/persona/lore/instructions + chat history). The max context length sent to API backends (Kobold, AI Horde, etc.) will automatically be calculated as (Prompt Context + Max Response Tokens).">Total Prompt Token Budget (Input Context)</label>
                        <input type="number" id="custom_bg_total_context_token_limit" class="text_pole" min="1" step="1" style="width:100%; margin-bottom:10px;" />

                        <hr>

                        <h4 style="margin-bottom: 4px;">Prompt LLM Request Overrides</h4>

                        <label title="Overrides maximum output tokens (max_tokens / responseLength) generated for the prompt text. Set to 0 or leave blank to use backend default.">Max API Response Tokens (max_tokens)</label>
                        <input type="number" id="custom_bg_gen_max_response" class="text_pole" min="0" step="1" placeholder="300 (0 = backend default)" style="width:100%; margin-bottom:10px;" />

                        <label title="Overrides sampling temperature for prompt generation (e.g. 0.7). Leave blank to use backend default.">API Temperature (optional)</label>
                        <input type="number" id="custom_bg_gen_temperature" class="text_pole" min="0" max="2" step="0.05" placeholder="(use backend default)" style="width:100%; margin-bottom:10px;" />

                        <hr>

                        <label title="Connection profile to switch to during prompt generation.">Connection Profile for Prompt LLM (optional)</label>
                        <select id="custom_bg_connection_profile" class="text_pole" style="width:100%; margin-bottom:10px;">
                            <option value="">(None - Use currently active API)</option>
                        </select>

                        <hr>

                        <label class="checkbox_label" title="Force an edit popup even if SillyTavern's standard SD prompt popup setting is disabled.">
                            <input type="checkbox" id="custom_bg_force_edit" />
                            <span>Always Show Prompt Edit Popup</span>
                        </label>

                        <label class="checkbox_label" title="Passes extend=false to the /sd command so this extension's own generated prompt is not re-elaborated by the LLM.">
                            <input type="checkbox" id="custom_bg_disable_free_extend" />
                            <span>Prevent &quot;Extend free mode prompts&quot; from re-processing generated prompts</span>
                        </label>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#extensions_settings').append(settingsHtml);

    // 3. Populate fields
    $('#custom_bg_genbg_system_prompt').val(moduleSettings.genbg.systemPrompt);
    $('#custom_bg_genbg_prompt_instruction').val(moduleSettings.genbg.promptInstruction);
    $('#custom_bg_gencustom_system_prompt').val(moduleSettings.gencustom.systemPrompt);
    $('#custom_bg_gencustom_prompt_instruction').val(moduleSettings.gencustom.promptInstruction);
    
    $('#custom_bg_include_character').prop('checked', moduleSettings.includeCharacter !== false);
    $('#custom_bg_include_persona').prop('checked', moduleSettings.includePersona !== false);
    $('#custom_bg_include_world_info').prop('checked', moduleSettings.includeWorldInfo !== false);

    $('#custom_bg_history_token_limit').val(moduleSettings.historyTokenLimit);
    $('#custom_bg_total_context_token_limit').val(moduleSettings.totalContextTokenLimit);
    
    $('#custom_bg_gen_max_response').val(moduleSettings.genMaxResponse || '');
    $('#custom_bg_gen_temperature').val(moduleSettings.genTemperature !== null && moduleSettings.genTemperature !== undefined ? moduleSettings.genTemperature : '');

    $('#custom_bg_force_edit').prop('checked', moduleSettings.forceEdit);
    $('#custom_bg_disable_free_extend').prop('checked', moduleSettings.disableFreeExtend !== false);

    // 4. Persistence bindings
    const saveSettings = () => {
        if (typeof saveSettingsDebounced === 'function') {
            saveSettingsDebounced();
        } else if (typeof context.saveSettingsDebounced === 'function') {
            context.saveSettingsDebounced();
        } else {
            console.warn('[scene-painter] Could not persist settings.');
        }
    };

    $('#custom_bg_genbg_system_prompt').on('input', function() {
        moduleSettings.genbg.systemPrompt = $(this).val();
        saveSettings();
    });
    $('#custom_bg_genbg_prompt_instruction').on('input', function() {
        moduleSettings.genbg.promptInstruction = $(this).val();
        saveSettings();
    });
    $('#custom_bg_gencustom_system_prompt').on('input', function() {
        moduleSettings.gencustom.systemPrompt = $(this).val();
        saveSettings();
    });
    $('#custom_bg_gencustom_prompt_instruction').on('input', function() {
        moduleSettings.gencustom.promptInstruction = $(this).val();
        saveSettings();
    });

    $('#custom_bg_include_character').on('change', function() {
        moduleSettings.includeCharacter = $(this).is(':checked');
        saveSettings();
    });
    $('#custom_bg_include_persona').on('change', function() {
        moduleSettings.includePersona = $(this).is(':checked');
        saveSettings();
    });
    $('#custom_bg_include_world_info').on('change', function() {
        moduleSettings.includeWorldInfo = $(this).is(':checked');
        saveSettings();
    });

    $('#custom_bg_history_token_limit').on('input', function() {
        const parsed = parseInt($(this).val(), 10);
        moduleSettings.historyTokenLimit = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HISTORY_TOKEN_LIMIT;
        saveSettings();
    });

    $('#custom_bg_total_context_token_limit').on('input', function() {
        const parsed = parseInt($(this).val(), 10);
        moduleSettings.totalContextTokenLimit = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOTAL_CONTEXT_TOKEN_LIMIT;
        saveSettings();
    });

    $('#custom_bg_gen_max_response').on('input', function() {
        const parsed = parseInt($(this).val(), 10);
        moduleSettings.genMaxResponse = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        saveSettings();
    });

    $('#custom_bg_gen_temperature').on('input', function() {
        const val = $(this).val().trim();
        if (val === '') {
            moduleSettings.genTemperature = null;
        } else {
            const parsed = parseFloat(val);
            moduleSettings.genTemperature = Number.isFinite(parsed) ? parsed : null;
        }
        saveSettings();
    });

    $('#custom_bg_force_edit').on('change', function() {
        moduleSettings.forceEdit = $(this).is(':checked');
        saveSettings();
    });

    $('#custom_bg_connection_profile').on('change', function() {
        moduleSettings.connectionProfile = $(this).val();
        saveSettings();
    });

    $('#custom_bg_disable_free_extend').on('change', function() {
        moduleSettings.disableFreeExtend = $(this).is(':checked');
        saveSettings();
    });

    refreshConnectionProfilesDropdown = async function populateConnectionProfilesDropdown() {
        const dropdown = document.getElementById('custom_bg_connection_profile');
        if (!dropdown) return;

        const currentValue = moduleSettings.connectionProfile || '';
        const profileNames = new Set();

        try {
            const connExt = window.extension_settings?.connectionProfiles;
            if (connExt?.profiles) {
                for (const profile of Object.values(connExt.profiles)) {
                    if (profile && profile.name) {
                        profileNames.add(profile.name.trim());
                    }
                }
            }
        } catch (e) { /* ignore */ }

        if (profileNames.size === 0) {
            const domSelects = document.querySelectorAll('select[id*="connection_profile"], select[id*="profile_select"]');
            domSelects.forEach(select => {
                if (select.id === 'custom_bg_connection_profile') return;
                Array.from(select.options).forEach(opt => {
                    const text = opt.textContent.trim();
                    if (text && opt.value && opt.value !== 'null' && opt.value !== 'undefined' && !text.startsWith('(')) {
                        profileNames.add(text);
                    }
                });
            });
        }

        dropdown.innerHTML = '<option value="">(None - Use currently active API)</option>';
        const sortedNames = [...profileNames].sort((a, b) => a.localeCompare(b));
        sortedNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            dropdown.appendChild(option);
        });

        if (currentValue) {
            const exists = sortedNames.includes(currentValue);
            if (exists) {
                dropdown.value = currentValue;
            } else {
                const missingOption = document.createElement('option');
                missingOption.value = currentValue;
                missingOption.textContent = currentValue + ' (Missing/Unknown)';
                dropdown.appendChild(missingOption);
                dropdown.value = currentValue;
            }
        } else {
            dropdown.value = '';
        }
    };
    refreshConnectionProfilesDropdown();

    function populatePresetsDropdown(selectId, presetsArray) {
        const select = $(`#${selectId}`);
        select.empty();
        select.append('<option value="def-natural">⭐ Default (Natural Language)</option>');
        select.append('<option value="def-tags">⭐ Default (Danbooru Tags)</option>');
        presetsArray.forEach((preset, index) => {
            select.append(`<option value="${index}">${preset.name}</option>`);
        });
    }

    function loadPresetToCommand(presetsArray, commandKey) {
        const selectId = `custom_bg_${commandKey}_preset_select`;
        const val = $(`#${selectId}`).val();
        if (val === null || val === undefined) return;

        let systemPrompt, promptInstruction, presetName;
        if (val === 'def-natural') {
            const def = defaultCommandSettings(commandKey, 'natural');
            systemPrompt = def.systemPrompt;
            promptInstruction = def.promptInstruction;
            presetName = 'Default (Natural Language)';
        } else if (val === 'def-tags') {
            const def = defaultCommandSettings(commandKey, 'tags');
            systemPrompt = def.systemPrompt;
            promptInstruction = def.promptInstruction;
            presetName = 'Default (Danbooru Tags)';
        } else {
            const index = parseInt(val, 10);
            const preset = presetsArray[index];
            if (!preset) return;
            systemPrompt = preset.systemPrompt;
            promptInstruction = preset.promptInstruction;
            presetName = preset.name;
        }

        $(`#custom_bg_${commandKey}_system_prompt`).val(systemPrompt).trigger('input');
        $(`#custom_bg_${commandKey}_prompt_instruction`).val(promptInstruction).trigger('input');
        if (typeof toastr !== 'undefined') toastr.success(`Loaded preset "${presetName}"`);
    }

    async function savePreset(commandKey, presetsArray) {
        const name = await promptPresetName();
        if (!name) return;

        const systemPrompt = $(`#custom_bg_${commandKey}_system_prompt`).val();
        const promptInstruction = $(`#custom_bg_${commandKey}_prompt_instruction`).val();
        presetsArray.push({ name, systemPrompt, promptInstruction });
        saveSettings();
        populatePresetsDropdown(`custom_bg_${commandKey}_preset_select`, presetsArray);
        $(`#custom_bg_${commandKey}_preset_select`).val(presetsArray.length - 1);
        if (typeof toastr !== 'undefined') toastr.success(`Saved preset "${name}"`);
    }

    function deletePreset(commandKey, presetsArray) {
        const selectId = `custom_bg_${commandKey}_preset_select`;
        const val = $(`#${selectId}`).val();
        if (val === 'def-natural' || val === 'def-tags' || val === '-1' || val === null || val === undefined) {
            if (typeof toastr !== 'undefined') toastr.warning('Cannot delete built-in Default presets.');
            return;
        }
        const index = parseInt(val, 10);
        if (!presetsArray[index]) return;
        const presetName = presetsArray[index].name;
        presetsArray.splice(index, 1);
        saveSettings();
        populatePresetsDropdown(selectId, presetsArray);
        if (typeof toastr !== 'undefined') toastr.success(`Deleted preset "${presetName}"`);
    }

    async function promptPresetName() {
        try {
            const popupPromise = callGenericPopup(
                'Enter a name for the new preset:',
                POPUP_TYPE.INPUT,
                '',
                { wide: true, okButton: 'Save', cancelButton: 'Cancel' }
            );
            const result = await popupPromise;
            return typeof result === 'string' && result.trim() ? result.trim() : null;
        } catch (err) {
            const name = window.prompt('Enter a name for the new preset:');
            return name ? name.trim() : null;
        }
    }

    populatePresetsDropdown('custom_bg_genbg_preset_select', moduleSettings.genbgPresets);
    populatePresetsDropdown('custom_bg_gencustom_preset_select', moduleSettings.gencustomPresets);

    $('#custom_bg_genbg_preset_load').on('click', () => loadPresetToCommand(moduleSettings.genbgPresets, 'genbg'));
    $('#custom_bg_genbg_preset_save').on('click', () => savePreset('genbg', moduleSettings.genbgPresets));
    $('#custom_bg_genbg_preset_delete').on('click', () => deletePreset('genbg', moduleSettings.genbgPresets));

    $('#custom_bg_gencustom_preset_load').on('click', () => loadPresetToCommand(moduleSettings.gencustomPresets, 'gencustom'));
    $('#custom_bg_gencustom_preset_save').on('click', () => savePreset('gencustom', moduleSettings.gencustomPresets));
    $('#custom_bg_gencustom_preset_delete').on('click', () => deletePreset('gencustom', moduleSettings.gencustomPresets));
}

export function mountExtensionUI() {
    if (document.getElementById('custom_bg_gen_container')) return;

    if (!document.getElementById('extensions_settings')) {
        let attempts = 0;
        const checkInterval = setInterval(() => {
            attempts += 1;
            if (document.getElementById('extensions_settings')) {
                clearInterval(checkInterval);
                initExtensionSettings();
            } else if (attempts >= 50) {
                clearInterval(checkInterval);
                console.warn('[scene-painter] Timed out waiting for #extensions_settings container.');
            }
        }, 50);
        return;
    }
    initExtensionSettings();
}

// Auto-mount on load
if (typeof document !== 'undefined') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        mountExtensionUI();
    } else {
        $(document).ready(mountExtensionUI);
    }
}

// Hook into ST ready event if available
if (eventSource && event_types?.APP_READY) {
    eventSource.on(event_types.APP_READY, () => {
        mountExtensionUI();
        refreshConnectionProfilesDropdown?.();
    });
}
