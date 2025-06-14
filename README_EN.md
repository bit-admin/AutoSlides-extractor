# AutoSlides Extractor

**AutoSlides Extractor** is a cross-platform desktop application built with Electron and Node.js, designed to automatically and efficiently extract presentation slides from video recordings,  It can analyze lecture recordings, meeting videos, webinars, and other video content to capture and save the slide images, greatly improving the efficiency of note-taking, content archiving, and information retrieval. With AutoSlides Extractor, users can quickly obtain key slide visuals from lengthy videos without manual screenshotting.

This project is an independent tool derived from the [AutoSlides project](https://github.com/bit-admin/Yanhekt-AutoSlides).

## Features

* **Wide Video Format Support:** Works with major video formats including MP4, AVI, MKV, MOV, and WebM. No additional conversion is needed – just load your video and start extracting slides.
* **Accurate Slide Change Detection:** Incorporates multiple slide detection algorithms – choose between a basic pixel-difference method or an advanced mode combining perceptual hash and structural similarity (SSIM) for robust slide change detection. The detection interval (time step between analyzed frames) is customizable.
* **Batch Processing with Queue:** Supports processing multiple videos in one session by adding them to a queue. You can select several video files at once; the app will queue them and extract slides sequentially. This is ideal for batch processing a series of lectures or meetings.
* **Configurable Parameters:** Users can adjust the slide extraction parameters:

  * Detection interval (in seconds) between frames to analyze.
  * Choice of comparison method (`basic` or `default` algorithms).
  * **Double Verification** option to require a slide change to persist for multiple frames before confirming a new slide (reduces false positives from transient changes).
  * **Region-based Detection** (advanced): Optionally focus slide detection on a specific region of the video frame (useful if slides occupy only part of the screen). By specifying a region size and position (e.g. top-right corner), the app will compare only that portion of each frame for changes.
* **Real-Time Progress and Preview:** While extracting, the app displays real-time progress, including the number of frames processed, slides detected, and elapsed time. Extracted slides are previewed in the interface as they are detected, and you can stop the process at any time.
* **Post-Processing to Remove Duplicates/Unwanted Slides:** The app can automatically remove images that match certain “exclude” slide fingerprints. You can mark specific slide images (or use built-in presets) to be skipped in future extractions. After extraction, a **post-processing** step can compare all captured slides against these fingerprints and delete any that are too similar (for example, duplicate title slides, corporate logo frames, or other repetitive content).
* **Cross-Platform Support:** Native installers are provided for **macOS** and **Windows**, and the application UI is consistent across platforms. *(Linux support may be added via source build, although official releases target macOS/Windows.)*
* **Performance Optimizations:** AutoSlides Extractor uses multi-threading to speed up analysis, taking advantage of multiple CPU cores for frame comparisons. Video decoding and frame capture are powered by the efficient `ffmpeg` engine. The tool is capable of processing lengthy videos in a short time (for example, processing a \~2.5 hour video with 2-second interval in around 1 minute on an Apple Silicon CPU, based on internal tests).

## Installation

### macOS

1. Download the latest **AutoSlides Extractor** `.dmg` installer from the [Releases page](https://github.com/bit-admin/AutoSlides-extractor/releases). Choose the build that matches your Mac’s architecture: Intel (`x64`) or Apple Silicon (`arm64`). For example: **`AutoSlides Extractor-1.2.0-macOS-arm64.dmg`**.
2. Open the downloaded `.dmg` file and drag **AutoSlides Extractor.app** into your **Applications** folder.
3. On first launch, macOS may flag the app as from an unidentified developer. If you encounter a security warning, open Terminal and remove the quarantine attribute with:

   ```bash
   sudo xattr -d com.apple.quarantine /Applications/AutoSlides\ Extractor.app
   ```

   Enter your password if prompted. This step is only required once to allow the app to run.
4. Launch **AutoSlides Extractor** from Applications. You may now use the app normally.

### Windows

1. Download the latest Windows installer (`.exe`) from the [Releases page](https://github.com/bit-admin/AutoSlides-extractor/releases). For example: **`AutoSlides Extractor-Setup-1.2.0-Windows-x64.exe`** (for 64-bit Windows).
2. Run the installer and follow the setup wizard. You can choose the installation directory and opt to create a desktop shortcut during installation.
3. After installation, launch **AutoSlides Extractor** from the Start Menu or the desktop shortcut. The application will open with a straightforward interface for selecting videos and configuring options.

*(No additional dependencies are required – the application bundles the necessary Node.js runtime and FFmpeg binaries. On macOS, FFmpeg is packaged within the app; on Windows, FFmpeg/FFprobe executables are bundled in the installer.)*

## Usage

Using AutoSlides Extractor is simple. Follow these steps to quickly extract slides from a video:

1. **Launch the application**. You will see the main window with options to select a video and configure parameters.
2. **Select Video File(s):** Click **“Select Video File”** and choose the video from which you want to extract slides. You can select a single video or **multiple videos**. Selecting multiple files will add them to the processing **queue**, visible in a list on the UI. The status bar will indicate how many videos are queued. If a single video is chosen, its path will be displayed.
3. *(Optional)* **Select Output Directory:** By default, extracted slide images will be saved to an `extracted` folder in your Downloads directory. To use a different location, click **“Select Output Directory”** and choose a folder.
4. *(Optional)* **Adjust Detection Interval:** Set the **“Detection Interval (seconds)”** to control how frequently the video frames are sampled. For example, an interval of 2 seconds means the app checks every 2 seconds of the video for slide changes (smaller intervals may capture slides that appear briefly but will increase processing time).
5. *(Optional)* **Choose Comparison Method:** Select a slide change detection algorithm from the **“Comparison Method”** dropdown:

   * **Default:** Uses a combination of perceptual hash and SSIM for robust detection (recommended for most cases).
   * **Basic:** Uses a simpler pixel-difference and change-ratio method (may be faster but can be sensitive to noise or minor changes).
6. *(Optional)* **Enable Double Verification:** If checked, the app will perform secondary verification of slide changes. This means when a slide change is detected, it will wait to see if the change persists across a few consecutive frames before confirming a new slide. Enabling this can reduce false positives (e.g. ignoring a brief flash or cursor movement that isn’t an actual slide change). By default this is on, requiring a change to persist for **3 consecutive frames** to register as a new slide.
7. *(Optional)* **Advanced Settings:** Click **“Advanced Settings”** to tweak additional parameters:

   * **Multi-core Processing:** Enable or disable use of multiple CPU cores (enabled by default for better performance).
   * **Thresholds:** Adjust the internal thresholds like pHash Hamming distance, SSIM similarity cutoff, pixel difference tolerance, etc. (Advanced users only – the defaults are tuned for typical slide content).
   * **Video Quality for Frames:** You can lower the extracted frame image quality (1 = highest quality, 31 = lowest) to speed up processing or save disk space if needed. The default is 1 (no quality loss).
   * **Region of Interest:** If slides occupy a specific region of the video (e.g., in a recorded meeting with camera feed plus slides), you can enable region-based comparison and specify the region dimensions and position. The app will then only analyze that portion of each frame for changes.
   * **Post-Processing Options:** Manage the slide fingerprints used to filter out unwanted slides. Here you can review, add, or remove **exclude fingerprints** (see *Post-Processing* below).
8. **Start Extraction:** Click **“Start Extraction”** to begin. If you added multiple videos to the queue, the button will show **“Start Queue”**, and the videos will be processed one after another automatically. During processing, a progress bar and status text will update in real time, and the interface will show the count of total frames processed and slides extracted so far.
9. **View Results:** As slides are detected, their thumbnails appear in the preview area at the bottom of the window. All extracted slides are saved as PNG image files in the output directory you selected (or the default `~/Downloads/extracted` folder). You can open this folder from your file explorer to view the full-sized images. Each slide image is time-stamped in its filename (e.g., `slide_001_timestamp.png`).
10. *(Optional)* **Stop or Reset:** You can click **“Stop Extraction”** at any time to halt the process. If processing a queue, this will stop after finishing the current video. To clear the current video/queue and reset the interface (clearing the preview and progress), click **“Reset”**. If a queue was active, resetting will also clear the queue.
11. *(Optional)* **Post-Process Slides:** After extraction, if you have configured any *exclude fingerprints* (see next section), you can run a post-processing step to remove slides that match those fingerprints. Click **“Select Slides Directory”** and choose the folder of slide images (the output directory), then click **“Run Post-Process”**. The app will compare each slide image against the stored fingerprints and delete any that are highly similar (e.g., duplicate cover slides). A summary will be shown of how many images were removed.

## Post-Processing and Fingerprint Exclusion

AutoSlides Extractor provides a powerful **exclude list** feature to automatically filter out slides that you consider unimportant or duplicative. This works by using **image fingerprints** (based on SSIM) to identify similar images:

* In the **Advanced Settings**, you can add a new fingerprint by clicking **“Add Exclude Image”** (this opens a file picker to select an image, e.g. a slide screenshot to exclude). You will then be prompted to configure the region (if any) for fingerprinting that image, then the app calculates and stores the image’s fingerprint.
* The list of exclude fingerprints is visible in Advanced Settings. Each fingerprint has an ID, a name, and a similarity threshold. You can edit or remove fingerprints from this list. Some fingerprints may be built-in **presets** (marked as such in the list) which cover common cases.
* When **Post-Processing** is run on a directory of slides, the app loads each stored fingerprint (and any presets) and compares every slide image in the folder against these fingerprints using SSIM. If a slide image is **>= 95% similar** (SSIM ≥ threshold, default 0.95) to any exclude fingerprint, that slide image file is deleted. This helps automatically eliminate slides that were detected but aren’t needed (for example, an introductory slide repeated in each video of a series, or a company logo frame).
* The fingerprint comparison accounts for the specified region if one was defined for the fingerprint. This means you can target a portion of the slide (for example, ignore slides that only differ by a speaker’s webcam thumbnail by focusing on the slide content region).

This exclude mechanism is optional; if no exclude fingerprints are configured, the post-processing step is not needed. The configuration for fingerprints is saved in the app’s user data (so your exclude list persists between runs).

## Project Structure

The AutoSlides Extractor project is organized into a few key directories and files:

* **`src/main/`** – **Main Process code (Node.js)**. This includes:

  * `main.js` – Entry point of the Electron app (runs in the main process). It creates the application window, sets up IPC handlers, loads and saves the configuration, orchestrates video frame extraction via ffmpeg, and manages the slide detection logic (including spawning worker threads for analysis).
  * `preload.js` – Preload script for the renderer. It defines a secure bridge (`contextBridge`) exposing certain APIs to the renderer for IPC (e.g., `electronAPI` methods like `selectVideoFile`, `getConfig`, `extractFrames`, etc.).
  * **`utils/`** – Helper modules for the main process. Notably, `utils/image-processor.js` implements image processing functions (e.g., resizing, grayscale conversion, simple image decoding) that were used for slide comparison. *(This is a custom lightweight alternative to using heavy libraries like Sharp.)*
  * **`workers/`** – Worker thread scripts for parallel image analysis. For example, `workers/image-processor.js` is the code run in each worker thread to compare frames and detect slide changes in parallel chunks. The main process spawns multiple worker threads (up to one less than the number of CPU cores by default) to speed up processing.
* **`src/renderer/`** – **Renderer Process code (Frontend)**. This contains the files for the app’s user interface:

  * `index.html` – The HTML structure of the app window, defining the layout of buttons, inputs, preview area, modals for advanced settings, etc.
  * `renderer.js` – The frontend JavaScript that handles user interactions and updates the UI. It calls the exposed `electronAPI` methods to invoke back-end operations (like opening file dialogs, starting extraction, receiving progress events, etc.). It also manages the queue UI, advanced settings modal logic, and real-time updates to progress and status.
  * `styles.css` – The CSS file for styling the application UI.
* **`src/assets/`** – **Static assets and presets**. Contains images and other assets packaged with the app. Notably, it includes a `fp/` subfolder with preset fingerprint files and a `presets.json` configuration. These presets may include example fingerprints for common slide elements (if provided) and are loaded on first run to populate the exclude list. The `assets` folder also typically contains the application icons and any graphical assets required at runtime.
* **`build/`** – Build configuration and resources for packaging:

  * Icons for different platforms (`icon.icns` for macOS, `icon.ico` for Windows), installer background images, and possibly platform-specific binaries. For Windows, the `build/binaries/win-x64/` folder contains the `ffmpeg.exe` and `ffprobe.exe` used by the app (these are copied into the installed app). On macOS, ffmpeg is included via the `ffmpeg-static` npm package and unpacked at build time.
  * The Electron Builder configuration is defined in `package.json` under the `build` field, specifying how to package the app for Mac (dmg) and Windows (NSIS installer).
* **Configuration & Data Files:** The app creates a user-specific data directory (usually in your OS’s app data path) to store `config.json` (which remembers your last used settings such as output directory, interval, algorithm choice, etc.) and a `fingerprints` directory for stored fingerprint data. This ensures that your preferences persist between sessions and across app updates.

## Technical Overview

Internally, AutoSlides Extractor follows a classic **Electron architecture** with a separation between the front-end **renderer process** and the back-end **main process**:

* The **Renderer Process** (frontend) is responsible for the graphical interface – it handles user input and displays output. It communicates with the main process through IPC (inter-process communication) calls, which are exposed via the secure `electronAPI` bridge in the preload script. For example, when a user clicks "Start", the renderer invokes a method that triggers frame extraction in the main process, and it listens for progress events to update the UI.
* The **Main Process** (backend) orchestrates the heavy lifting:

  * It uses **Fluent FFmpeg** (`fluent-ffmpeg` library) to open the video file and extract frames at the specified interval. Frames are saved as image files (JPEG by default) in a temporary directory.
  * As frames are extracted, the main process either processes them sequentially or distributes them across **worker threads** (using Node.js **Worker Threads**) for analysis. By default, multi-core analysis is enabled, and the app will spawn a number of workers based on your CPU cores (e.g., if you have 4 cores, it might use 3 workers, leaving one core free for the main thread).
  * Each worker thread runs the slide detection algorithm on a chunk of frames. The algorithm compares each frame to the previous one to decide if a slide change occurred. Detected slide frames are sent back to the main process.
  * The main process aggregates results from workers, updates progress, and when a new slide is confirmed, it saves the slide image to the output directory and notifies the renderer (which in turn updates the preview in the UI).
  * The main process also handles saving the configuration (e.g., when you change settings) and loading it on startup, as well as managing the exclude fingerprints storage and the post-processing routine.

### Slide Change Detection Algorithm

AutoSlides Extractor’s core logic is determining when a slide transition occurs in the video. It provides two modes for this comparison:

**1. Basic Mode (`basic`):** A fast algorithm that performs a pixel-wise comparison between consecutive frames. It calculates the absolute difference for each pixel and counts how many pixels differ beyond a certain threshold in color value. If the proportion of differing pixels exceeds a set ratio (default 0.5% of pixels with differences greater than a value of 30) it flags a significant change. This method is simple and works well for large changes, but it can be sensitive to noise (small movements or flashes might trigger it).

**2. Default Mode (`default`):** A more robust algorithm that combines **Perceptual Hash (pHash)** and **Structural Similarity Index (SSIM)** to decide if a slide has changed:

* **Perceptual Hash (pHash):** The frame is scaled down and transformed (DCT) to produce a fingerprint hash. By comparing hashes of two frames, we get a Hamming distance – essentially a measure of how different the images are. If the Hamming distance is below a threshold (frames are very similar, e.g., threshold ≤ 5), the content is considered the same.
* **SSIM (Structural Similarity):** This metric evaluates images the way a human eye might, focusing on luminance, contrast, and structural information. SSIM yields a similarity score between -1 and 1; two identical images have SSIM = 1. If the SSIM between two frames is above a high threshold (e.g. ≥ 0.999, meaning almost no difference), they are considered the same.
* **Combined Decision:** In default mode, a new slide is detected only if the frames fail both similarity checks – i.e., the pHash difference is large *or* the SSIM drops below the threshold. This combination helps catch slide changes that involve significant visual differences (which pHash would catch) as well as more subtle changes (where SSIM would drop even if pHash sometimes doesn’t catch a small change).

**Double Verification:** Regardless of mode, the app can use a “double verification” mechanism if enabled. With double verification, when a frame is found to be different enough to signal a potential new slide, the algorithm doesn’t immediately confirm it. It will temporarily mark this frame as a *candidate slide*, and then require that the next few frames (by default 2 subsequent frames) remain similar to this candidate frame in order to confirm that the slide truly changed and the video isn’t just flickering or showing a brief overlay. If the next frame(s) confirm the change, the candidate frame is finalized as a new slide; if not, it was likely a false alarm and the slide count isn’t increased. This approach greatly reduces false positives from things like a cursor moving, a small transition animation, or brief subtitles appearing.

**File Size Heuristic:** As an initial quick check, the app also compares the file size of consecutive frame images. If the sizes differ by more than a certain percentage (default 5%), it’s a strong indicator the images differ (so it immediately treats it as a change). Conversely, if the file sizes are almost identical (difference below 0.05%), it assumes the frames are the same and skips more expensive calculations. This heuristic speeds up processing by avoiding unnecessary pixel or hash computations for obviously identical frames.

All these thresholds and constants (such as the pHash Hamming distance limit, SSIM threshold, pixel difference ratio, etc.) are configurable via the advanced settings or by modifying the source code defaults. The defaults have been chosen to work well for slide detection in typical scenarios.

### Performance and Parallelism

Slide extraction is a CPU-intensive task, especially the image comparison steps. AutoSlides Extractor is designed to leverage multi-core CPUs by splitting the work. By default, it will spawn worker threads to process frame sequences in parallel – essentially dividing the video into chunks of frames for each worker to handle. This can lead to near-linear speedups on multi-core systems, making use of modern processors to analyze videos faster. You can disable multi-core processing in settings (in case you want to reserve CPU for other tasks), but generally it’s recommended to leave it on for best performance.

Memory-wise, the application processes one frame at a time per worker (frames are loaded, compared, then released), so it can handle long videos without needing to load the entire video into memory at once. However, for extremely high resolution videos or very short intervals, the number of frames can be large, so ensure you have sufficient disk space in the output directory for the extracted images.

### Advanced Features: Region-Based Analysis and Fingerprinting

As mentioned, the application supports focusing on a sub-region of the video frame for slide change detection. This is useful if, for example, the video has picture-in-picture where slides occupy only part of the frame. In such cases, random changes outside the slides (like speaker video or backgrounds) could interfere with detection. By enabling region-based comparison, you can specify a region (width, height, and alignment such as center, top-right, etc.) and the algorithm will only compare that region of each frame. The region alignment options include top/center/bottom and left/center/right, so you can easily target, say, the bottom-right quarter of the frame if that’s where the slides are. Region-based comparison is applied in the SSIM fingerprint calculations as well – ensuring that if you set a region, the fingerprint and comparisons only consider that portion of the image.

The fingerprinting system used for post-processing is also available for extension. The app ships with some **preset fingerprints** (found in `src/assets/fp`) which might correspond to commonly excluded slides or patterns. These are automatically initialized and stored in the user’s fingerprint storage on first run. The fingerprint files (`.fp` extension) and a `presets.json` define these presets, each with its own threshold and optional region config. Developers can add new preset fingerprints if desired, or users can import/export fingerprints via the UI (for example, to share an exclude list with a colleague).

Under the hood, a fingerprint is essentially a small binary file representing the SSIM-based signature of an image (with optional region). Comparing two fingerprints yields a similarity score (0 to 1). If the similarity is above the configured threshold, the images are considered a match.

Overall, these advanced features (region focus and fingerprint exclusion) make the tool adaptable to various real-world scenarios, ensuring that it can extract slides as cleanly as possible with minimal noise.

## Development Guide

If you are a developer interested in exploring or extending AutoSlides Extractor, this section will help you get started with the codebase.

**Prerequisites:** You should have [Node.js](https://nodejs.org/) installed (the project is tested with Node.js and Electron versions corresponding to Electron 35.x). Ensure you also have npm (Node Package Manager) available.

**Setup and Running in Development:**

1. **Clone the Repository:** Clone the GitHub repository `bit-admin/AutoSlides-extractor` to your local machine.
2. **Install Dependencies:** In the project directory, run `npm install`. This will install Electron, Electron-Builder, and all Node dependencies (including `fluent-ffmpeg`, `ffmpeg-static`, etc. as listed in `package.json`). The `ffmpeg-static` package will provide FFmpeg/FFprobe binaries for development usage.
3. **Start the App in Dev Mode:** Run `npm run dev`. This will launch the Electron application in development mode (with hot-reloading if configured). The main window should appear, and you can open the developer tools (Ctrl+Shift+I or Cmd+Opt+I) for debugging the renderer process if needed. In dev mode, the app will use the `ffmpeg` from `ffmpeg-static` and dynamic code (not packaged).
4. **Folder Structure:** Refer to the *Project Structure* section above for an overview of key files. When making changes:

   * Frontend changes (HTML/JS/CSS) will reflect when you reload the app window.
   * Main process changes require restarting the Electron process. Utilize console logging in the terminal for main process logs, and the browser devtools console for renderer logs.
5. **Building Packages:** To create distributable installers, run `npm run build`. The build process uses Electron Builder and will produce output in the `dist/` directory by default. Make sure to adjust any configuration in `package.json` under the `build` field if you want to, for example, build a Linux package or change app metadata. By default:

   * On macOS, it will create a `.dmg` installer (and `.app` bundle) with the app name and version.
   * On Windows, it will create an NSIS installer `.exe` (and supporting files).
   * The build process is configured to embed the necessary binaries and resources as described earlier (see `extraResources` and `asarUnpack` settings in `package.json`).
6. **Configuration and Data during development:** The app will read/write config and fingerprint data in the electron user data folder. In dev mode this is typically a folder like `~/Library/Application Support/AutoSlides Extractor (development)` on macOS or `%APPDATA%/AutoSlides Extractor (development)` on Windows. You can reset configuration by deleting the `config.json` there while the app is not running.

**Extending Functionality:**

* *Adding a New Detection Algorithm:* If you want to implement a new slide change detection method, you would likely:

  * Modify the comparison logic in `src/main/workers/image-processor.js`. The function `compareImages(buffer1, buffer2, method)` is where the current `basic` and `default` methods are implemented. You could add a new `method` string and implement your algorithm there. Also update the UI dropdown in `index.html`/`renderer.js` to allow selecting your method.
  * Ensure thresholds or parameters for your method are configurable if needed (you can extend the config JSON structure and Advanced Settings modal to add new fields).
* *Modifying UI/UX:* The UI is built with plain HTML/CSS/JS, so you can modify `index.html` and `styles.css` for layout or style changes. For adding new UI controls, also update `renderer.js` to handle their behavior and link with main process IPC calls as needed.
* *Working with IPC:* Communication between renderer and main is done via the `electronAPI` (see `preload.js`). If you add a new feature that requires main process work, define an IPC channel (using `ipcMain.handle` in `main.js` for requests, or `ipcMain.on`/`ipcRenderer.send` for events). Expose a function in `preload.js` to let the renderer call it. There are many examples in the code (e.g., `ipcMain.handle('extract-frames', ...)` in main and `electronAPI.extractFrames` in preload).
* *Testing:* Currently, the project does not include automated tests. As a developer, you can test changes by running different videos through the app. Sample test videos with known slide transitions (or even synthetic videos) are useful to verify the detection accuracy and performance.

## License

AutoSlides Extractor is released under the **MIT License**. This means you are free to use, modify, and distribute the software. See the `LICENSE` file in the repository for the full license text.

All third-party libraries and tools included (such as Electron, FFmpeg, etc.) are under their respective licenses. By using this software, you agree to adhere to all relevant licenses. The MIT license for AutoSlides Extractor explicitly covers the source code in this repository.