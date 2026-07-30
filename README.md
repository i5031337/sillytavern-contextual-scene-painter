
---

# Contextual Scene Painter (SillyTavern Extension)

**Contextual Scene Painter** is a no-nonsense AI image prompt generation extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern). It analyzes your ongoing chat history (optionally including active character card details, persona, and/or World Info), to synthesize context-aware image prompts on the fly.

---

## ✨ Features

- **Context-Aware Prompt Generation**: Automatically synthesizes recent chat turns, target character lore, user persona, and relevant World Info entries into clean, high-quality image prompts. Optionally, start context from any past message.
- **Bypasses Strict LLM Constraints**: Bypasses active chat presets, system prompts, and character post-history instructions that usually interfere with AI image prompt formatting.
- **Two Specialized Modes**:
  - **`/drawbg` (Background Mode)**: Focuses on environment design, cinematic framing, weather, lighting, and scenery. Automatically uploads the generated image and applies it to your active chat background at 1080p resolution.
  - **`/drawscene` (Inline Scene Mode)**: Focuses on narrative action, character dynamic poses, expressions, dynamic visual elements, and focal compositions, outputting images directly into your chat stream.
- **Dedicated LLM Connection Profiles**: Save tokens on your primary story model by routing image prompt generation to a secondary API/connection profile (e.g., a fast, low-cost model like Gemini Flash, Haiku, or Llama 3 8B).
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
<img width="1147" height="740" alt="Screenshot 2026-07-30 184300" src="https://github.com/user-attachments/assets/132c74fa-9b30-4582-8c07-83fd4f96f7f6" />
<img width="1137" height="428" alt="Screenshot 2026-07-30 184334" src="https://github.com/user-attachments/assets/a91673d8-9fff-4cb3-8bce-8e058b7aa03a" />


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

# Specific direction for the scene
/drawbg make it sunny

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
- **Prompt Instruction**: Fine-tune instructions regarding formatting, style emphasis, tag styles, or negative exclusions.
- **Chat History Token Limit**: Set the maximum token length of recent chat context fed into prompt generation (default: `2048` tokens).
- **Always Show Prompt Edit Popup**: Check this box to force an edit modal prior to image rendering, allowing you to manually refine prompt tags.
- **Connection Profile for Prompt LLM**: Pick an optional connection profile (e.g., local small LLM or fast cloud model) to generate the prompt text. The extension switches to this profile during prompt generation and automatically restores your previous active profile afterward.
<img width="570" height="955" alt="Screenshot 2026-07-30 184421" src="https://github.com/user-attachments/assets/3a98c0b6-1746-400b-bacb-3b5db29de3ab" />
<img width="567" height="230" alt="Screenshot 2026-07-30 184442" src="https://github.com/user-attachments/assets/f059f967-3241-4a42-8ac9-f381560d5c45" />


---

## 📄 License

Distributed under the MIT License. Feel free to modify and extend!
