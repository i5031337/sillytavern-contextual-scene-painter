import { SlashCommandParser } from '/scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '/scripts/slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE } from '/scripts/slash-commands/SlashCommandArgument.js';
import { getContext, extension_settings } from '/scripts/extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '/script.js';
import { callGenericPopup, POPUP_TYPE } from '/scripts/popup.js';

// ==========================================
// EXTENSION SETTINGS & UI
// ==========================================
let moduleSettings = {};
let refreshConnectionProfilesDropdown = null;

// Background-focused prompts (/drawbg or /genbg) -- natural-language style (advanced text-encoder models)
const DEFAULT_GENBG_SYSTEM_PROMPT = 'You are an expert AI image prompt engineer specializing in cinematic environment art, mecha, architecture, landscape design, and visual background scene building for storytelling.';
const DEFAULT_GENBG_PROMPT_INSTRUCTION = 'Synthesize the provided location, lore, and recent story context into a detailed, immersive image prompt focused on the environment. Describe the setting, atmosphere, lighting, camera perspective/framing, weather, textures, and mood. Exclude speech bubbles, text overlays, and main character portrait details. Output ONLY the raw image prompt text with no conversational intro, quotes, markdown wrappers, or explanation.';

// Scene/Character-focused prompts (/drawscene or /gencustom) -- natural-language style
const DEFAULT_GENCUSTOM_SYSTEM_PROMPT = 'You are an expert AI image prompt engineer specializing in visual narrative illustration, character design, cinematic framing, and story scene composition.';
const DEFAULT_GENCUSTOM_PROMPT_INSTRUCTION = 'Synthesize the provided character information, scene context, and recent actions into a vivid image prompt capturing this exact narrative moment. Describe the subject(s), dynamic poses, facial expressions, attire, scene framing, focal elements, lighting, and surrounding environment. Output ONLY the raw image prompt text with no conversational intro, quotes, markdown wrappers, or explanation.';

// Background-focused prompts -- Danbooru/booru tag style (SDXL and similar tag-trained models)
const DEFAULT_GENBG_SYSTEM_PROMPT_TAGS = 'You are an expert Stable Diffusion prompt engineer who writes Danbooru-style booru tag lists for environment, architecture, and background scene art.';
const DEFAULT_GENBG_PROMPT_INSTRUCTION_TAGS = 'Synthesize the provided location, lore, and recent story context into a comma-separated list of Danbooru-style booru tags describing the environment. Cover setting/location, time of day, lighting, weather, architecture or terrain, color palette, and camera framing (e.g. wide shot, from above, no humans). Do not include characters, speech bubbles, or text. Output ONLY the raw comma-separated tag list in lowercase, with no numbering, headers, markdown, or explanation.';

// Scene/Character-focused prompts -- Danbooru/booru tag style
const DEFAULT_GENCUSTOM_SYSTEM_PROMPT_TAGS = 'You are an expert Stable Diffusion prompt engineer who writes Danbooru-style booru tag lists for character and narrative scene art.';
const DEFAULT_GENCUSTOM_PROMPT_INSTRUCTION_TAGS = 'Synthesize the provided character information, scene context, and recent actions into a comma-separated list of Danbooru-style booru tags capturing this exact narrative moment. Cover subject count (e.g. 1girl, 1boy), pose/action, expression, clothing/attire, framing/shot type, setting, and lighting. Output ONLY the raw comma-separated tag list in lowercase, with no numbering, headers, markdown, or explanation.';

const DEFAULT_HISTORY_TOKEN_LIMIT = 2048;
const DEFAULT_TOTAL_CONTEXT_TOKEN_LIMIT = 8192;
const DEFAULT_PROMPT_STYLE = 'natural'; // 'natural' | 'tags'

function defaultCommandSettings(commandKey = 'genbg', promptStyle) {
    const style = promptStyle || moduleSettings?.promptStyle || DEFAULT_PROMPT_STYLE;
    const useTags = style === 'tags';
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

function initExtensionSettings() {
    if (document.getElementById('custom_bg_gen_container')) return;

    const context = getContext();

    // 1. Initialize default settings
    if (!extension_settings.customBgGen) {
        extension_settings.customBgGen = {
            genbg: defaultCommandSettings('genbg', DEFAULT_PROMPT_STYLE),
            gencustom: defaultCommandSettings('gencustom', DEFAULT_PROMPT_STYLE),
            forceEdit: true,
            connectionProfile: '',
            genMaxResponse: 0,
            genTemperature: null,
            promptStyle: DEFAULT_PROMPT_STYLE,
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

    // Migrate old prompt settings
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
    if (typeof moduleSettings.promptStyle !== 'string') moduleSettings.promptStyle = DEFAULT_PROMPT_STYLE;
    if (!moduleSettings.genbg) moduleSettings.genbg = defaultCommandSettings('genbg');
    if (!moduleSettings.gencustom) moduleSettings.gencustom = defaultCommandSettings('gencustom');
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

    // 2. Inject UI
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

                        <label title="Default prompt style used when loading the built-in 'Default' preset or resetting a command's prompts.">Default Prompt Style</label>
                        <select id="custom_bg_prompt_style" class="text_pole" style="width:100%; margin-bottom:10px;">
                            <option value="natural">Natural language (advanced text-encoder models)</option>
                            <option value="tags">Danbooru tags (SDXL and similar tag-trained models)</option>
                        </select>
                        <div style="display: flex; gap: 5px; margin-bottom: 10px;">
                            <button id="custom_bg_genbg_style_reset" class="menu_button" style="flex:1;" title="Overwrite Background prompts with the selected style's defaults">Reset Background to Style Default</button>
                            <button id="custom_bg_gencustom_style_reset" class="menu_button" style="flex:1;" title="Overwrite Scene prompts with the selected style's defaults">Reset Scene to Style Default</button>
                        </div>

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
    $('#custom_bg_prompt_style').val(moduleSettings.promptStyle || DEFAULT_PROMPT_STYLE);
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

    $('#custom_bg_prompt_style').on('change', function() {
        moduleSettings.promptStyle = $(this).val();
        saveSettings();
    });

    $('#custom_bg_disable_free_extend').on('change', function() {
        moduleSettings.disableFreeExtend = $(this).is(':checked');
        saveSettings();
    });

    $('#custom_bg_genbg_style_reset').on('click', () => {
        const def = defaultCommandSettings('genbg', moduleSettings.promptStyle);
        $('#custom_bg_genbg_system_prompt').val(def.systemPrompt).trigger('input');
        $('#custom_bg_genbg_prompt_instruction').val(def.promptInstruction).trigger('input');
        toastr.success('Background prompts reset to style default.');
    });

    $('#custom_bg_gencustom_style_reset').on('click', () => {
        const def = defaultCommandSettings('gencustom', moduleSettings.promptStyle);
        $('#custom_bg_gencustom_system_prompt').val(def.systemPrompt).trigger('input');
        $('#custom_bg_gencustom_prompt_instruction').val(def.promptInstruction).trigger('input');
        toastr.success('Scene prompts reset to style default.');
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
                if (select.id === 'custom_bg_connection_profile') return; // Exclude self
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
        select.append('<option value="-1">⭐ Default</option>');
        presetsArray.forEach((preset, index) => {
            select.append(`<option value="${index}">${preset.name}</option>`);
        });
    }

    function loadPresetToCommand(presetsArray, commandKey) {
        const selectId = `custom_bg_${commandKey}_preset_select`;
        const index = $(`#${selectId}`).val();
        if (index === null || index === undefined) return;

        let systemPrompt, promptInstruction, presetName;
        if (index === '-1') {
            const def = defaultCommandSettings(commandKey, moduleSettings.promptStyle);
            systemPrompt = def.systemPrompt;
            promptInstruction = def.promptInstruction;
            presetName = 'Default';
        } else {
            const preset = presetsArray[index];
            if (!preset) return;
            systemPrompt = preset.systemPrompt;
            promptInstruction = preset.promptInstruction;
            presetName = preset.name;
        }

        $(`#custom_bg_${commandKey}_system_prompt`).val(systemPrompt).trigger('input');
        $(`#custom_bg_${commandKey}_prompt_instruction`).val(promptInstruction).trigger('input');
        toastr.success(`Loaded preset "${presetName}"`);
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
        toastr.success(`Saved preset "${name}"`);
    }

    function deletePreset(commandKey, presetsArray) {
        const selectId = `custom_bg_${commandKey}_preset_select`;
        const index = $(`#${selectId}`).val();
        if (index === '-1' || index === null || index === undefined) {
            toastr.warning('Cannot delete the built-in Default preset.');
            return;
        }
        if (!presetsArray[index]) return;
        const presetName = presetsArray[index].name;
        presetsArray.splice(index, 1);
        saveSettings();
        populatePresetsDropdown(selectId, presetsArray);
        toastr.success(`Deleted preset "${presetName}"`);
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

function mountExtensionUI() {
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

// Mount immediately on module load / DOM ready
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    mountExtensionUI();
} else {
    $(document).ready(mountExtensionUI);
}

// Optionally refresh dropdowns once ST reaches full APP_READY status
if (eventSource && event_types?.APP_READY) {
    eventSource.on(event_types.APP_READY, () => {
        mountExtensionUI();
        refreshConnectionProfilesDropdown?.();
    });
}

// ==========================================
// CORE LOGIC & HELPERS
// ==========================================

function isEditPromptEnabled() {
    if (moduleSettings.forceEdit) return true;
    const context = getContext();
    return !!context.extension_settings?.sd?.refine_mode;
}

function tightenPromptPopupLayout() {
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

async function promptUserForEdit(currentPrompt) {
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

function resolveCharacterIndex(cardName) {
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

function replaceMacros(text, charName = '', userName = '') {
    if (!text) return '';
    return text
        .replace(/{{char}}/gi, () => charName)
        .replace(/{{user}}/gi, () => userName);
}

function quoteSlashArg(s) {
    return `"${String(s).replace(/"/g, '\\"')}"`;
}

// Cleans Markdown fencing or extraneous wrapping quotes returned by stubborn LLMs
function cleanGeneratedPrompt(rawText) {
    if (!rawText) return '';
    let cleaned = rawText.trim();
    cleaned = cleaned.replace(/^```[\w-]*\s*/i, '').replace(/\s*```$/i, '');
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1).trim();
    }
    return cleaned;
}

function sanitizePromptForSlashCommand(promptText) {
    if (!promptText) return '';
    return promptText
        .replace(/\{\{/g, '{ {')  // Break macro syntax so LLM output can't trigger ST macros
        .replace(/\}\}/g, '} }')
        .replace(/\|/g, ',')      // Prevent pipe command chaining
        .replace(/\r?\n+/g, ' ')  // Collapse linebreaks
        .replace(/\s+/g, ' ')     // Collapse whitespace
        .trim();
}

function parseBoolArg(value, defaultValue) {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    return defaultValue;
}

let tokenizerModule = null;
async function getTokenizer() {
    if (!tokenizerModule) {
        try {
            tokenizerModule = await import('/scripts/tokenizers.js');
        } catch (e) { /* fallback */ }
    }
    return tokenizerModule;
}

async function countTokens(text) {
    if (!text) return 0;
    const tok = await getTokenizer();
    if (tok?.getTokenCountAsync) return await tok.getTokenCountAsync(text);
    if (tok?.getTokenCount) return tok.getTokenCount(text);
    return Math.ceil(text.length / 4);
}

async function buildRecentMessagesBlock(chatLog, userName, tokenLimit) {
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

async function getActivePersonaDescription() {
    try {
        const puModule = await import('/scripts/power-user.js');
        const desc = puModule?.power_user?.persona_description;
        return typeof desc === 'string' ? desc.trim() : '';
    } catch (err) {
        return '';
    }
}

let profileSwitchQueue = Promise.resolve();

async function readActiveProfileName(context) {
    const result = await context.executeSlashCommands('/profile');
    return (result?.pipe ?? result?.value ?? result ?? '').toString().trim();
}

async function collectSettingsTargets(context) {
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

async function withTemporarySettingsOverride({ maxContext, temperature }, fn) {
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

async function executeRawGeneration(context, fullRawPrompt) {
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

async function generateWithOptionalProfile(context, fullRawPrompt) {
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

async function buildImagePrompt(userInstruction, targetCard, commandKey, options = {}) {
    const {
        includePersona = moduleSettings.includePersona !== false,
        includeWorldInfo = moduleSettings.includeWorldInfo !== false,
        includeCharacter = moduleSettings.includeCharacter !== false,
        messageId = null
    } = options;

    const context = getContext();
    const defaults = defaultCommandSettings(commandKey);
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
        toastr.warning(`Character/lore/persona content alone is ~${fixedTokens} tokens -- at or over your Total Prompt Token Budget (${totalBudget}). No room left for chat history this generation.`);
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

async function uploadAndSetBackground(imageUrl) {
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

        toastr.success('Background generated and applied to this chat!');
    } catch (err) {
        toastr.error(`Failed to apply background: ${err.message}`);
    }
}

async function dispatchToSD(context, sdCommand) {
    if (moduleSettings.disableFreeExtend !== false && !/\bextend=/.test(sdCommand)) {
        sdCommand = sdCommand.replace(/^\/sd\b/, '/sd extend=false');
    }
    return await context.executeSlashCommands(sdCommand);
}

// ==========================================
// COMMAND REGISTRATIONS
// ==========================================

// Command 1: Background Generation
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

        toastr.info('Generating background image...');

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
                    toastr.info('Background generation cancelled.');
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
            toastr.error(`Background generation failed: ${err.message}`);
        }
        return '';
    },
    helpString: 'Generates a custom background using /drawbg [card="Card Name"|true|false] [width=1920] [height=1080] [negative="..."] [persona=true|false] [worldinfo=true|false] [messageid=x] [optional direction]. messageid generates from message x (and prior context) instead of the most recent message.',
}));

// Command 2: Inline Scene Generation
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

        toastr.info('Generating scene image...');

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
                    toastr.info('Image generation cancelled.');
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

            toastr.success('Scene image requested!');

            return imageUrl || (typeof rawPipe === 'string' ? rawPipe : '');

        } catch (err) {
            toastr.error(`Scene image generation failed: ${err.message}`);
        }
        return '';
    },
    helpString: 'Generates a scene image in chat using /drawscene [card="Card Name"|true|false] [width=(sd default)] [height=(sd default)] [negative="..."] [persona=true|false] [worldinfo=true|false] [messageid=x] [optional direction]. messageid generates from message x (and prior context) instead of the most recent message. Returns the generated image path via {{pipe}}, so it can be chained, e.g. /drawscene | /something-else {{pipe}}.',
}));