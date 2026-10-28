# AI Avatar Overlay

A Chrome extension that displays an animated avatar overlay on AI chat websites (ChatGPT, Gemini). The avatar responds to AI interactions with different animations and optional emotion analysis.

## Features

- 🎭 **Animated Avatar Overlay**: Floating avatar with multiple states (idle, thinking, speaking, happy, sad, excited, confused)
- 🔄 **Automatic Response Detection**: Uses MutationObserver to detect new AI responses
- 🎨 **Multiple Site Support**: Works with ChatGPT and Gemini (extensible to other sites)
- 🧠 **Optional Emotion Analysis**: Integrate with Gemini or OpenAI APIs for advanced emotion detection
- 🎯 **Clean Architecture**: Built with SOLID principles and design patterns
- ✅ **Well-Tested**: Comprehensive unit tests with Vitest
- 🎨 **Draggable UI**: Repositionable avatar overlay
- 📑 **Chat Page Tools**: ChatGPT question navigation and date-based history cleanup; conversation/answer downloads in Markdown, HTML, or PDF. Gemini exports loaded messages; PDF uses browser print.
- 🖼️ **Avatar Customization**: Saved position and size, corner resizing, expression-pack import, and image ZIP export
- 💬 **First-use Guide**: Tips through the existing avatar and speech bubble; double-click the avatar to replay

## Architecture

### Design Patterns

- **Factory Pattern**: `SiteAdapterFactory`, `LlmAdapterFactory` for creating site/LLM-specific adapters
- **Strategy Pattern**: `ISiteAdapter`, `ILlmAdapter` interfaces for swappable implementations
- **Observer Pattern**: State change callbacks and MutationObserver for DOM monitoring
- **Dependency Injection**: Constructor injection for better testability

### Module Structure

```
src/
├── common/           # Shared types, interfaces, constants
│   ├── types.ts      # Core domain types
│   ├── interfaces.ts # SOLID interfaces
│   ├── constants.ts  # Configuration constants
│   └── utils.ts      # Utility functions
├── avatar/           # Avatar UI and control
│   ├── AvatarOverlay.ts    # Visual overlay management
│   └── AvatarController.ts # State management
├── content/          # Content script layer
│   ├── contentScript.ts    # Main entry point
│   └── ResponseWatcher.ts  # DOM observation
├── background/       # Service worker layer
│   ├── background.ts       # Main service worker
│   └── ConfigService.ts    # Configuration management
├── adapters/         # Strategy implementations
│   ├── SiteAdapterFactory.ts # Site-specific DOM adapters
│   └── LlmAdapterFactory.ts  # LLM API adapters
└── options/          # Options page
    ├── options.html
    └── options.ts
```

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type checking
npm run type-check

# Linting
npm run lint
npm run lint:fix

# Build extension
npm run build

# Development build with watch
npm run dev
```

### Building

```bash
npm run build
```

The extension will be built to the `dist/` directory.

### Loading in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist/` directory

## Testing

The project uses Vitest for unit testing with comprehensive coverage:

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Test Structure

- `tests/unit/` - Unit tests for individual modules
- `tests/setup.ts` - Chrome API mocks for testing

## Configuration

Access the options page via the extension icon to configure:

- **Enable/Disable**: Toggle the avatar overlay
- **Avatar Style**: Choose between different avatar themes
- **LLM Provider**: Select emotion analysis provider (None, Gemini, OpenAI)
- **API Key**: Enter your LLM API key for emotion analysis
- **Page Features**: Independently toggle question navigation, downloads, and history cleanup

## Architecture Principles

### SOLID Principles

1. **Single Responsibility**: Each class has one clear purpose
   - `AvatarOverlay`: Only handles UI rendering
   - `AvatarController`: Only manages state
   - `ResponseWatcher`: Only observes DOM changes

2. **Open/Closed**: Extensible without modification
   - Add new sites via `ISiteAdapter`
   - Add new LLM providers via `ILlmAdapter`

3. **Liskov Substitution**: All adapters are interchangeable
   - Any `ISiteAdapter` works with `ResponseWatcher`
   - Any `ILlmAdapter` works with `BackgroundService`

4. **Interface Segregation**: Focused interfaces
   - Separate interfaces for overlay, controller, watcher, config

5. **Dependency Inversion**: Depend on abstractions
   - All modules depend on interfaces, not concrete classes

### Clean Code Practices

- **Type Safety**: Full TypeScript coverage
- **No Magic Numbers**: All constants defined in `constants.ts`
- **Error Handling**: Comprehensive error handling with fallbacks
- **Performance**: Throttled DOM observers, debounced callbacks
- **Testability**: Dependency injection, mocked Chrome APIs

## Extension Capabilities

### Supported Sites

- ChatGPT (chatgpt.com, chat.openai.com)
- Google Gemini (gemini.google.com)

### Avatar States

- **Idle**: Default resting state
- **Thinking**: When waiting for AI response
- **Speaking**: During AI response
- **Happy**: Positive emotion detected
- **Sad**: Negative emotion detected
- **Excited**: Enthusiastic response
- **Confused**: Uncertain or questioning response

## Future Enhancements

- [ ] More avatar themes and customization
- [ ] Support for additional AI chat sites
- [ ] Custom avatar upload
- [ ] Voice synthesis integration
- [ ] Advanced emotion detection algorithms
- [ ] Analytics and usage tracking

## Disclaimer / 免責聲明

This extension is an **unofficial**, independently developed project and is **not affiliated with, endorsed by, or associated with** OpenAI (ChatGPT), Google (Gemini), or any other AI service provider.

- The extension interacts with third-party websites by observing DOM changes. These websites may update their structure at any time, which could cause the extension to stop working without notice.
- Use of LLM API features (Gemini, OpenAI) requires your own API key and is subject to the respective provider's terms of service and pricing.
- The extension does **not** collect, transmit, or store any personal data. All settings are stored locally via Chrome Storage.
- The authors are **not responsible** for any issues arising from the use of this extension, including but not limited to account restrictions, data loss, or unexpected behavior.

**Use at your own risk.**

---

本擴充功能為**非官方**的獨立開發專案，與 OpenAI（ChatGPT）、Google（Gemini）或任何其他 AI 服務提供商**無任何關聯、背書或合作關係**。

- 本擴充功能透過觀察 DOM 變化與第三方網站互動。這些網站可能隨時更新其結構，導致擴充功能在無預警的情況下停止運作。
- 使用 LLM API 功能（Gemini、OpenAI）需要您自行提供 API 金鑰，並受相關服務提供商的使用條款與定價約束。
- 本擴充功能**不會**蒐集、傳輸或儲存任何個人資料。所有設定皆透過 Chrome Storage 儲存於本機。
- 作者**不對**因使用本擴充功能所產生的任何問題負責，包括但不限於帳號限制、資料遺失或非預期行為。

**使用風險自負。**

## License

This project is licensed under the [MIT License](LICENSE).

## Contributing

Pull requests are welcome! Please ensure:

1. All tests pass: `npm test`
2. Type checking passes: `npm run type-check`
3. Linting passes: `npm run lint`
4. Code follows existing architecture patterns
