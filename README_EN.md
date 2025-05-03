# AutoSlides Extractor

AutoSlides Extractor is a cross-platform desktop application based on Electron and Node.js, designed to efficiently and accurately extract slide pages from various video files. It is ideal for scenarios such as online course recordings, meeting notes, academic lectures, and more, helping users quickly obtain key slide content from videos and greatly improving the efficiency of data organization and knowledge archiving.

## Project Overview

This project is an independent tool derived from the [AutoSlides project](https://github.com/bit-admin/Yanhekt-AutoSlides), suitable for a wide range of applications:

- Archiving slides from online courses and academic lecture videos
- Organizing video materials from corporate meetings and technical sharing sessions
- Extracting key points from live stream replays
- Any scenario requiring batch extraction of PPT pages from videos

## Features

- Supports major video formats: mp4, avi, mkv, mov, webm
- Multiple slide detection algorithms (pixel difference, perceptual hash, structural similarity SSIM)
- Customizable detection interval, output directory, and double verification
- Real-time progress display and slide preview
- Cross-platform support (macOS, Windows)

## Installation Guide

### macOS

1. Go to the project [Releases page](https://github.com/bit-admin/AutoSlides-extractor/releases).
2. Download the latest `.dmg` file for your architecture (Intel `x64` or Apple Silicon `arm64`), e.g., `AutoSlides Extractor-1.0.0-macOS-arm64.dmg`.
3. Open the `.dmg` file and drag the app into the `Applications` folder.
4.  When running the application for the first time, you may receive a security warning. To bypass this warning, execute the following command:
   ```bash
   sudo xattr -d com.apple.quarantine /Applications/AutoSlides\ Extractor.app
   ```
4. You can now launch the app from `Applications`.

### Windows

1. Go to the project [Releases page](https://github.com/bit-admin/AutoSlides-extractor/releases).
2. Download the latest `.exe` installer for your architecture (usually `x64`), e.g., `AutoSlides Extractor-Setup-1.0.0-Windows-x64.exe`.
3. Run the installer and follow the wizard to complete installation.
4. Choose the installation path and whether to create a desktop shortcut.
5. After installation, launch the app from the Start menu or desktop shortcut.

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

## Configuration Instructions

All user interface configurable options are automatically saved in the `config.json` file in the user data directory, allowing them to be automatically loaded the next time the application starts. Key configuration items include:
- Output Directory (outputDir)
- Check Interval (checkInterval)
- Comparison Method (comparisonMethod)
- Enable Double Verification (enableDoubleVerification)
- Verification Count (verificationCount): Number of consecutive frames required for double verification.

Lower-level parameters and default values can be adjusted in the source code:
- `src/main/main.js`: Contains the `defaultConfig` used at application startup (defining default values for basic configuration items) and constant thresholds related to the core image comparison algorithms (e.g., `HAMMING_THRESHOLD_UP`, `SSIM_THRESHOLD`, `PIXEL_DIFF_THRESHOLD`, `PIXEL_CHANGE_RATIO_THRESHOLD`, `VERIFICATION_COUNT`, `SIZE_IDENTICAL_THRESHOLD`, `SIZE_DIFF_THRESHOLD`, etc.).

## Technical Implementation

- **Frontend**: Electron + HTML/CSS/JavaScript, responsive interface design, multi-platform support.
- **Backend**: Node.js, responsible for video decoding, frame extraction, and image processing scheduling.
- **Core Algorithm**: The application uses the `fluent-ffmpeg` library to extract frame images from the video at specified time intervals (`checkInterval`). The task of comparing frames to detect slide transitions is now primarily performed in the **main process**, utilizing **Node.js Worker Threads for multi-core parallel processing** to accelerate the analysis.
    - **Frame Comparison Strategies**:
        - **File Size Quick Comparison**: Before performing complex image comparisons, the file sizes of the two frames are compared. If the size difference is minimal (below `SIZE_IDENTICAL_THRESHOLD`), they are considered identical; if the difference is significant (above `SIZE_DIFF_THRESHOLD`), they might be different. This quickly eliminates some obviously identical or different frames.
        - **Basic Mode (`basic`)**: Calculates the absolute difference in pixel values between two frames. If the number of pixels with a difference exceeding `PIXEL_DIFF_THRESHOLD` (default 30) constitutes a proportion greater than `PIXEL_CHANGE_RATIO_THRESHOLD` (default 0.005) of the total pixels, a significant change is considered to have occurred. This method is computationally simple and fast but is sensitive to video noise and minor variations.
        - **Default Mode (`default`)**: Combines Perceptual Hashing (pHash) and Structural Similarity Index (SSIM) for more robust detection.
            - **Perceptual Hash (pHash)**: Converts the image to grayscale, scales it down, performs a Discrete Cosine Transform (DCT), calculates the median of the DCT coefficients, and generates a binary hash fingerprint. By calculating the Hamming Distance between the pHash fingerprints of two frames, if the distance is less than or equal to `HAMMING_THRESHOLD_UP` (default 5), the content is considered similar. pHash is robust against scaling, slight blurring, brightness adjustments, etc.
            - **Structural Similarity (SSIM)**: Compares the similarity of two images based on luminance, contrast, and structure. The calculated SSIM value ranges from -1 to 1, with values closer to 1 indicating higher similarity. When the SSIM value is greater than or equal to `SSIM_THRESHOLD` (default 0.999), the two frames are considered highly similar structurally. SSIM aligns better with human perception of image quality.
            - **Decision Logic**: In the default mode, a potential slide transition is initially identified only if the pHash Hamming distance is *greater* than the threshold **or** the SSIM value is *less* than the threshold.
    - **Double Verification (`enableDoubleVerification`)**: To reduce false positives caused by transient obstructions (like mouse pointers or temporary notifications), enabling this option caches the current frame when a potential transition is detected. Only if the subsequent `VERIFICATION_COUNT` (default 2) consecutive frames maintain sufficient similarity with the cached frame (i.e., neither pHash nor SSIM triggers the transition condition again) is the cached frame finally confirmed as a new slide.
- **Configuration Management**: User settings are automatically saved, supporting personalized parameter adjustments.
- **Performance Considerations**: Slide extraction (especially the frame image comparison analysis phase) is a **CPU-intensive** task. Processing speed largely depends on your computer's CPU performance. The application implements **multi-core processing** support (enabled by default, can be disabled via `ENABLE_MULTI_CORE` in `main.js`), attempting to utilize multiple CPU cores to accelerate the analysis process, which is particularly effective when processing a large number of frames.

## FAQ

**Q1: What video formats are supported?**
A: mp4, avi, mkv, mov, webm, and other major formats.

**Q2: How to improve slide detection accuracy?**
A: Adjust the detection interval, choose the most suitable comparison algorithm, and enable double verification.

**Q3: Where are the output images saved?**
A: By default, in the `extracted` folder under "Downloads". You can customize the output path in the interface.

**Q4: What if the configuration is lost?**
A: The configuration is automatically saved in the user data directory. If there is an issue, delete `config.json` and reconfigure.