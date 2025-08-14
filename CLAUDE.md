# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AutoSlides Extractor is an Electron desktop application that automatically extracts presentation slides from video recordings. It uses FFmpeg for video processing and implements custom image comparison algorithms to detect slide changes.

## Development Commands

### Core Development
- `npm run dev` - Start the application in development mode with hot reloading
- `npm run build` - Build distributable packages for the current platform
- `npm install` - Install all dependencies including Electron, FFmpeg binaries, and Jimp

### Testing
No automated test framework is configured. Testing is done manually by processing videos with known slide transitions.

## Architecture

### Electron Multi-Process Architecture
- **Main Process** (`src/main/main.js`): Orchestrates video processing, manages FFmpeg operations, spawns worker threads for parallel image analysis
- **Renderer Process** (`src/renderer/`): Handles UI interactions, displays progress, manages queue and settings
- **Preload Script** (`src/main/preload.js`): Secure bridge between main and renderer processes via `electronAPI`

### Core Components

#### Video Processing Pipeline
1. **Frame Extraction**: Uses `fluent-ffmpeg` to extract frames at specified intervals
2. **Parallel Analysis**: Distributes frame comparison across worker threads (default: CPU cores - 1)
3. **Slide Detection**: Implements two algorithms:
   - `basic`: Pixel-difference based comparison
   - `default`: Combined perceptual hash (pHash) + SSIM analysis
4. **Double Verification**: Optional feature requiring slide changes to persist across multiple frames

#### Key Files
- `src/main/main.js`: Main process entry point, IPC handlers, configuration management
- `src/main/workers/image-processor.js`: Worker thread code for parallel frame analysis
- `src/main/utils/image-processor.js`: High-quality image processing using Jimp library
- `src/renderer/renderer.js`: Frontend logic, UI updates, queue management
- `src/renderer/index.html`: Application UI structure
- `src/assets/fp/`: Preset fingerprints for post-processing exclusion

### Configuration System
- User settings stored in Electron's userData directory as `config.json`
- Fingerprint data stored in `fingerprints/` subdirectory
- Advanced thresholds configurable via UI (pHash distance, SSIM threshold, etc.)

### FFmpeg Integration
- **Development**: Uses `ffmpeg-static` and `ffprobe-static` npm packages
- **Production**: Platform-specific binaries bundled in `build/binaries/` (Windows) or unpacked from npm packages (macOS)
- Paths automatically resolved based on `app.isPackaged` state

### Multi-threading Performance
- Spawns worker threads up to `Math.max(1, os.cpus().length - 1)`
- Each worker processes frame chunks independently
- Results aggregated in main process for slide confirmation

## Key Features Implementation

### Region-Based Detection
- Allows focusing slide detection on specific video regions (e.g., for picture-in-picture scenarios)
- Configurable region size and alignment (top/center/bottom, left/center/right)

### Post-Processing Fingerprints
- SSIM-based fingerprint system for excluding unwanted slides
- Preset fingerprints loaded from `src/assets/fp/presets.json`
- User can add custom exclusion patterns via UI

### Queue Processing
- Supports batch processing of multiple videos
- Queue state managed in renderer, processed sequentially in main process

## Development Notes

### Adding New Detection Algorithms
- Modify `compareImages()` function in `src/main/workers/image-processor.js`
- Add new method option to UI dropdown in `index.html` and `renderer.js`
- Update configuration schema if new parameters needed

### IPC Communication Pattern
- Main process handlers: `ipcMain.handle('channel-name', handler)`
- Preload exposure: `electronAPI.methodName` in `contextBridge`
- Renderer calls: `await electronAPI.methodName(params)`

### Platform-Specific Considerations
- Windows builds include FFmpeg binaries in `extraResources`
- macOS uses `asarUnpack` for FFmpeg from npm packages
- Quarantine removal required on macOS for unsigned builds

### Image Processing with Jimp
- **High-Quality Processing**: Uses Jimp library for professional-grade image operations
- **Bicubic Resizing**: Employs `Jimp.RESIZE_BICUBIC` for superior image scaling quality
- **Gaussian Blur**: Native Jimp blur implementation for noise reduction
- **Grayscale Conversion**: Proper luminance-based grayscale conversion
- **Error Handling**: Robust fallback mechanisms for corrupted or unsupported images
- **Memory Efficient**: Lazy loading and caching of Jimp image instances

### Performance Tuning
- Adjust `MAX_WORKERS` constant for different CPU configurations
- Threshold constants at top of `main.js` control detection sensitivity
- Frame quality setting (1-31) balances speed vs accuracy
- Jimp operations are cached to avoid redundant processing