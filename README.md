
---

# Contextual Scene Painter (SillyTavern Extension)

**Contextual Scene Painter** is a no-nonsense AI image prompt generation extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern). It analyzes your ongoing chat history (optionally including any character card details, active persona, and/or World Info), to synthesize context-aware image prompts on the fly.

---

## ✨ Features

- **Context-Aware Prompt Generation**: Automatically synthesizes recent chat turns, target character lore, user persona, and relevant World Info entries into clean, high-quality image prompts. Optionally, start context from any past message.
- **Bypasses Strict LLM Constraints**: Bypasses active chat presets, system prompts, and character post-history instructions that usually interfere with AI image prompt formatting.
- **Two Specialized Modes**:
  - **`/drawbg` (Background Mode)**: Focuses on environment design, cinematic framing, weather, lighting, and scenery. Automatically uploads the generated image and applies it to your active chat background at 1080p resolution.
  - **`/drawscene` (Inline Scene Mode)**: Focuses on narrative action, character dynamic poses, expressions, dynamic visual elements, and focal compositions, outputting images directly into your chat stream.
- **Dedicated LLM Connection Profiles**: Save tokens on your primary story model by routing image prompt generation to a secondary API/connection profile (e.g., a fast, low-cost model. I've found Gemma4 E4B to be effective).
- **Independent Context Token Limit**: Set a strict token cap on how much recent chat history is fed into the image prompt generator.
- **Interactive Prompt Editing**: Option to force a review popup modal before generating, letting you fine-tune or edit the LLM's prompt before image generation.
- **Preset Management**: Save, load, and manage custom prompt presets for both background and scene generation tasks.

---

## 🛠️ Prerequisites

This extension relies on SillyTavern's built-in **Stable Diffusion (`/sd`)** command. Ensure that your image generation API (Automatic1111, ComfyUI, Forge, Horde, WebUI, etc.) is configured and enabled in SillyTavern's extension settings.

---

## 📥 Installation

1. Open SillyTavern and navigate to the **Extensions** menu (puzzle piece icon).
2. Click **Install Extension**.
3. Paste the repository URL for this extension or install it manually by placing the extension folder into:
   ```text
   SillyTavern/public/scripts/extensions/third-party/contextual-scene-painter
   ```
4. Refresh or restart SillyTavern.

---

## 🚀 Commands & Usage


### 1. `/drawscene` (Generate Inline Chat Scene)

Generates an image prompt capturing the current dynamic narrative moment (including characters, action, poses, lighting, and expressions) and outputs the image directly into the chat stream.

**Aliases:** `/gencustom`, `/genchat`, `/snapshot`, `/drawchat`

#### Syntax:
```slash
/drawscene [card="Card Name"] [width=1024] [height=1024] [negative="..."] [persona=true|false] [worldinfo=true|false] [optional specific direction]
```

#### Examples:
```slash
# Basic generation based on recent chat context
/drawscene

# Specific direction for the scene
/drawscene show me Elara
```

<img width="1147" height="740" alt="Screenshot 2026-07-30 184300" src="https://github.com/user-attachments/assets/132c74fa-9b30-4582-8c07-83fd4f96f7f6" />
<img width="1132" height="756" alt="Screenshot 2026-07-30 191335" src="https://github.com/user-attachments/assets/c1a92e9c-6ea8-48c3-973d-a76b6659958d" />


---
### 2. `/drawbg` (Generate & Apply Chat Background)

Generates an environment/background image prompt based on the setting and context, requests an image via `/sd`, uploads it, and sets it as the active chat background.

**Aliases:** `/genbg`, `/bgdraw`, `/paintbg`

#### Syntax:
```slash
/drawbg [card="Card Name"] [width=1920] [height=1080] [negative="..."] [persona=true|false] [worldinfo=true|false] [optional specific direction]
```

#### Examples:
```slash
# Basic generation based on recent chat context (1920x1080 default)
/drawbg

# Target a specific character card for context
/drawbg card="Seraphina" include Seraphina on the left
```

<img width="1153" height="478" alt="Screenshot 2026-07-30 190017" src="https://github.com/user-attachments/assets/404db6d2-8a19-4cea-bed7-836e3655a977" />
<img width="1917" height="906" alt="Screenshot 2026-07-30 190112" src="https://github.com/user-attachments/assets/211bf6db-d8a0-4cc0-93d5-572d9f847abe" />

---

## ⚙️ Named Arguments Matrix

| Argument | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `card` | `String` | *(Active Card)* | Name or avatar filename of a target character card to inject into prompt context. |
| `width` | `Number` | `1920` (`/drawbg`) / Default `/sd` | Output image width in pixels. |
| `height` | `Number` | `1080` (`/drawbg`) / Default `/sd` | Output image height in pixels. |
| `negative` | `String` | `""` | Additional negative prompt terms to append to the generation call. |
| `persona` | `Boolean` | `true` | Set to `false` to exclude your active User Persona description. |
| `worldinfo` | `Boolean` | `true` | Set to `false` to exclude triggered World Info / Lorebook entries. |
| `messageid` | `Number` | `{{lastMessageID}}` | Specify a previous message to use for image context. |

---

## 🎛️ Extension Settings

Open SillyTavern's **Extensions** tab and expand **Contextual Scene Painter** to adjust the following settings:

- **Background & Scene Presets**: Quickly save, load, or delete custom system prompts and prompt generation instructions.
- **System Prompt Override**: Customize the system role prompt fed to the prompt generation LLM.
- **Prompt Instruction**: Fine-tune instructions regarding formatting, style emphasis, tag styles, or negative exclusions. Defaults provided for both new models that understand natural language and SD1.5/SDXL based which require Danbooru tags.
- **Prompt Context Defaults**: Whether the information in your Persona, active Character, and triggered Lorebook entries will be included with chat history.
- **Chat History Token Limit**: Set the maximum token length of recent chat context fed into prompt generation (default: `2048` tokens).
- **Total Prompt Token Budget**: Chat history plus any character, persona, lore included will not exceed this value. Set to avoid exceeding max_context_length when using Text Completion or AI Horde.
- **Max API Response Tokens**: Self-explanatory. Passed to LLM.
- **Temperature**: Maybe you want high-temp crazy narration but a lower value here for strict analytical image prompts.
- **Connection Profile for Prompt LLM**: Pick an optional connection profile (e.g., local small LLM or fast cloud model) to generate the prompt text. The extension switches to this profile during prompt generation and automatically restores your previous active profile afterward. Supports Chat Completion, Text Completion, and AI Horde.
- **Always Show Prompt Edit Popup**: Check this box to force an edit modal prior to image rendering, allowing you to manually refine prompt tags.
- **Prevent "Extend Free Mode Prompts"**: Override global /sd setting.
  <img width="570" height="789" alt="Screenshot 2026-08-05 184611" src="https://github.com/user-attachments/assets/b1e5dfcc-b088-4b26-bbe2-82370f7f7807" />
  <img width="568" height="590" alt="Screenshot 2026-08-05 184634" src="https://github.com/user-attachments/assets/c2559afb-bc80-4720-80c7-4ca98ad233ef" />




---

## 📄 License

Distributed under the MIT License. Feel free to modify and extend!
