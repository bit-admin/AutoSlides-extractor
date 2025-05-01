# AutoSlides Extractor

AutoSlides Extractor is a cross-platform desktop application based on Electron and Node.js, designed to efficiently and accurately extract slide pages from various video files. It is ideal for scenarios such as online course recordings, meeting notes, academic lectures, and more, helping users quickly obtain key slide content from videos and greatly improving the efficiency of data organization and knowledge archiving.

---

## Project Overview

This project is an independent tool derived from the [AutoSlides project](https://github.com/bit-admin/Yanhekt-AutoSlides), suitable for a wide range of applications:

- Archiving slides from online courses and academic lecture videos
- Organizing video materials from corporate meetings and technical sharing sessions
- Extracting key points from live stream replays
- Any scenario requiring batch extraction of PPT pages from videos

---

## Features

- Supports major video formats: mp4, avi, mkv, mov, webm
- Multiple slide detection algorithms (pixel difference, perceptual hash, structural similarity SSIM)
- Customizable detection interval, output directory, and double verification
- Real-time progress display and slide preview
- Cross-platform support (macOS, Windows)

---

## Installation Guide

### macOS

1. Go to the project [Releases page](https://github.com/bit-admin/AutoSlides-extractor/releases).
2. Download the latest `.dmg` file for your architecture (Intel `x64` or Apple Silicon `arm64`), e.g., `AutoSlides Extractor-1.0.0-macOS-arm64.dmg`.
3. Open the `.dmg` file and drag the app into the `Applications` folder.
4.  When running the application for the first time, you may receive a security warning. To bypass this warning, execute the following command:
   ```bash
   sudo xattr -d com.apple.quarantine /Applications/AutoSlides.app
   ```
4. You can now launch the app from `Applications`.

### Windows

1. Go to the project [Releases page](https://github.com/bit-admin/AutoSlides-extractor/releases).
2. Download the latest `.exe` installer for your architecture (usually `x64`), e.g., `AutoSlides Extractor-Setup-1.0.0-Windows-x64.exe`.
3. Run the installer and follow the wizard to complete installation.
4. Choose the installation path and whether to create a desktop shortcut.
5. After installation, launch the app from the Start menu or desktop shortcut.

---

## Quick Start

1. Launch **AutoSlides Extractor**.
2. Click "Select Video File" to import the video for slide extraction (supports mp4, avi, mkv, mov, webm).
3. (Optional) Click "Select Output Directory" to customize the save path for slide images. By default, images are saved in the `extracted` folder under "Downloads".
4. (Optional) Adjust the "Detection Interval (seconds)" to set the time step for frame detection.
5. (Optional) Choose the "Comparison Method":
    - `default`: Perceptual hash algorithm and structural similarity index
    - `basic`: Pixel difference and change ratio
6. (Optional) Enable "Double Verification" to reduce false positives (requires multiple consecutive similar frames to confirm a new slide).
7. Click "Start Extraction". The app will process automatically, showing progress, frame count, slide count, and elapsed time.
8. You can click "Stop Extraction" at any time to interrupt.
9. After extraction, view PNG slide images in the output directory and preview them at the bottom of the interface.
10. Click "Reset" to clear the current state and preview.

---

## Configuration

All configurable options in the user interface are automatically saved in a `config.json` file under the user data directory for automatic loading on next startup. Main configuration items include:
- Output directory (`outputDir`)
- Detection interval (`checkInterval`)
- Comparison method (`comparisonMethod`)
- Double verification enabled (`enableDoubleVerification`)
- Capture strategy thresholds (e.g., `hammingThresholdUp`, `ssimThreshold`, defined in renderer.js)

Advanced parameters and defaults can be adjusted in the source code:
- `src/main/main.js`: Contains `defaultConfig` for basic configuration defaults.
- `src/renderer/renderer.js`: Defines frontend logic and core image comparison algorithms, including constants like `PIXEL_DIFF_THRESHOLD`, `PIXEL_CHANGE_RATIO_THRESHOLD`, `HAMMING_THRESHOLD_UP`, `SSIM_THRESHOLD`, `SSIM_C1_FACTOR`, `SSIM_C2_FACTOR`, `VERIFICATION_COUNT`, etc.

---

## Technical Details

- **Frontend**: Electron + HTML/CSS/JavaScript, responsive design, multi-platform support
- **Backend**: Node.js, responsible for video decoding, frame extraction, and image processing
- **Core Algorithms**: Uses the `fluent-ffmpeg` library to extract frames from videos at specified intervals (`checkInterval`), then compares frames in the renderer process to detect slide transitions.
    - **Frame Comparison Strategies**:
        - **Basic Mode (`basic`)**: Calculates the absolute pixel difference between two frames. If the number of pixels exceeding the `PIXEL_DIFF_THRESHOLD` (default 30) accounts for more than `PIXEL_CHANGE_RATIO_THRESHOLD` (default 0.005) of total pixels, a significant change is detected. This method is fast but sensitive to noise and minor changes.
        - **Default Mode (`default`)**: Combines perceptual hash (pHash) and structural similarity index (SSIM) for robust detection.
            - **Perceptual Hash (pHash)**: Converts the image to grayscale, resizes it, performs DCT, computes the median of DCT coefficients, and generates a binary hash. The Hamming distance between two pHash fingerprints is calculated; if the distance is less than or equal to `HAMMING_THRESHOLD_UP` (default 5), the content is considered similar. pHash is robust to scaling, slight blurring, and brightness changes.
            - **Structural Similarity (SSIM)**: Compares two images in terms of luminance, contrast, and structure. SSIM values range from -1 to 1, with values closer to 1 indicating higher similarity. If SSIM is greater than or equal to `SSIM_THRESHOLD` (default 0.999), the frames are considered structurally similar. SSIM aligns better with human visual perception.
            - **Decision Logic**: In default mode, a potential slide transition is detected only if the pHash Hamming distance is *greater than* the threshold **or** the SSIM value is *less than* the threshold.
    - **Double Verification (`enableDoubleVerification`)**: To reduce false positives caused by brief occlusions (e.g., mouse pointer, notifications), enabling this option caches the current frame when a potential transition is detected. Only if the next `VERIFICATION_COUNT` (default 2) consecutive frames remain highly similar to the cached frame (i.e., neither pHash nor SSIM triggers a transition) is the cached frame confirmed as a new slide.
- **Configuration Management**: User settings are saved automatically, supporting personalized parameter adjustments.

---

## FAQ

**Q1: What video formats are supported?**
A: mp4, avi, mkv, mov, webm, and other major formats.

**Q2: How to improve slide detection accuracy?**
A: Adjust the detection interval, choose the most suitable comparison algorithm, and enable double verification.

**Q3: Where are the output images saved?**
A: By default, in the `extracted` folder under "Downloads". You can customize the output path in the interface.

**Q4: What if the configuration is lost?**
A: The configuration is automatically saved in the user data directory. If there is an issue, delete `config.json` and reconfigure.