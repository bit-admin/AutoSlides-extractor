# AutoSlides Extractor

[**English Version**](README_EN.md) 👈 Click here for English

AutoSlides Extractor 是一款基于 Electron 和 Node.js 的跨平台桌面应用，能够自动从各类视频文件中高效、精准地提取幻灯片页面。适用于在线课程录播、会议记录、学术讲座等场景，帮助用户快速获取视频中的关键幻灯片内容，极大提升资料整理与知识归档效率。

## 项目简介

本项目是 [AutoSlides](https://github.com/bit-admin/Yanhekt-AutoSlides) 项目的的独立工具程序，广泛适用于各类应用场景：

- 线上课程、学术讲座视频的幻灯片归档
- 企业会议、技术分享视频资料整理
- 直播回放内容的知识点提取
- 需要批量提取 PPT 页面的各类视频场景

## 功能亮点

- 支持 mp4、avi、mkv、mov、webm 等主流视频格式
- 多种幻灯片检测算法可选（像素差异、感知哈希、结构相似性 SSIM）
- 可自定义检测间隔、输出目录、二次验证等参数
- 实时进度显示与幻灯片预览
- 跨平台支持（macOS、Windows）

## 安装指南

### macOS

1. 前往项目的 [Releases 页面](https://github.com/bit-admin/AutoSlides-extractor/releases)。
2. 下载适用于您架构（Intel `x64` 或 Apple Silicon `arm64`）的最新 `.dmg` 文件（如：`AutoSlides Extractor-1.0.0-macOS-arm64.dmg`）。
3. 打开 `.dmg` 文件，将应用拖入 `Applications` 文件夹。
4. 首次运行应用程序时，您可能会收到安全警告。要绕过此警告，请执行以下命令：
   ```bash
   sudo xattr -d com.apple.quarantine /Applications/AutoSlides\ Extractor.app
   ```
5. 现在您可以从 `Applications` 启动应用。

### Windows

1. 前往项目的 [Releases 页面](https://github.com/bit-admin/AutoSlides-extractor/releases)。
2. 下载适用于您架构（通常为 `x64`）的最新 `.exe` 安装包（如：`AutoSlides Extractor-Setup-1.0.0-Windows-x64.exe`）。
3. 运行安装包，按向导完成安装。
4. 可选择安装路径、是否创建桌面快捷方式等。
5. 安装完成后，从开始菜单或桌面快捷方式启动应用。

## 快速上手

1. 启动 **AutoSlides Extractor** 应用。
2. 点击“选择视频文件”，导入需提取幻灯片的视频（支持 mp4、avi、mkv、mov、webm）。
3. （可选）点击“选择输出目录”，自定义幻灯片图片保存路径，默认在“下载”文件夹下的 `extracted` 目录。
4. （可选）调整“检测间隔（秒）”，设置帧间检测的时间步长。
5. （可选）选择“对比方法”：
    - `default`：感知哈希算法和结构相似性指数
    - `basic`：像素差异与变化比例
6. （可选）勾选“启用二次验证”，可减少误判（需连续多帧相似才判定为新幻灯片）。
7. 点击“开始提取”，应用将自动处理并显示进度、帧数、幻灯片数量及用时。
8. 可随时点击“停止提取”中断。
9. 提取完成后，在输出目录查看 PNG 格式幻灯片图片，并可在界面下方预览。
10. 点击“重置”可清空当前状态和预览。

## 配置说明

所有用户界面可配置项均会自动保存在用户数据目录下的 `config.json` 文件，便于下次启动时自动加载。主要配置项包括：
- 输出目录（outputDir）
- 检测间隔（checkInterval）
- 对比方法（comparisonMethod）
- 是否启用二次验证（enableDoubleVerification）
- 二次验证所需连续帧数（verificationCount）

更底层参数及默认值可在源码中调整：
- `src/main/main.js`：包含应用启动时的 `defaultConfig`（定义基础配置项的默认值）以及核心图像对比算法相关的常量阈值（如 `HAMMING_THRESHOLD_UP`, `SSIM_THRESHOLD`, `PIXEL_DIFF_THRESHOLD`, `PIXEL_CHANGE_RATIO_THRESHOLD`, `VERIFICATION_COUNT`, `SIZE_IDENTICAL_THRESHOLD`, `SIZE_DIFF_THRESHOLD` 等）。

## 技术实现

- **前端**：Electron + HTML/CSS/JavaScript，界面响应式设计，支持多平台
- **后端**：Node.js，负责视频解码、帧提取与图像处理调度
- **核心算法**：应用通过 `fluent-ffmpeg` 库按指定时间间隔（`checkInterval`）从视频中提取帧图像。帧间对比以检测幻灯片切换的任务主要在 **主进程** 中完成，并利用 **Node.js Worker Threads 实现多核并行处理**，以加速分析过程。
    - **帧间对比策略**：
        - **文件大小快速比较**：在进行复杂的图像比较前，会先比较两帧的文件大小。如果大小差异极小（低于 `SIZE_IDENTICAL_THRESHOLD`），则认为它们相同；如果差异显著（大于 `SIZE_DIFF_THRESHOLD`），则可能不同。这可以快速排除掉一些明显相同或不同的帧。
        - **基础模式 (`basic`)**：计算两帧之间像素值的绝对差。如果差异超过 `PIXEL_DIFF_THRESHOLD` (默认 30) 的像素数量占总像素的比例超过 `PIXEL_CHANGE_RATIO_THRESHOLD` (默认 0.005)，则认为发生了显著变化。此方法计算简单快速，但对视频噪声和细微变化较敏感。
        - **默认模式 (`default`)**：结合使用感知哈希（pHash）和结构相似性指数（SSIM）进行更鲁棒的检测。
            - **感知哈希 (pHash)**：将图像转换为灰度图，缩放至小尺寸，进行离散余弦变换（DCT），计算DCT系数的中位数，生成二进制哈希指纹。通过计算两帧pHash指纹的汉明距离（Hamming Distance），若距离小于等于 `HAMMING_THRESHOLD_UP` (默认 5)，则认为内容相似。pHash对图像的缩放、轻微模糊、亮度调整等具有较好的鲁棒性。
            - **结构相似性 (SSIM)**：从亮度、对比度、结构三个维度比较两图像的相似性。计算得到的 SSIM 值范围在 -1 到 1 之间，越接近 1 表示越相似。当 SSIM 值大于等于 `SSIM_THRESHOLD` (默认 0.999) 时，认为两帧在结构上高度相似。SSIM 更符合人眼对图像质量的感知。
            - **决策逻辑**：在默认模式下，只有当 pHash 汉明距离 *大于* 阈值 **或** SSIM 值 *小于* 阈值时，才初步判断为潜在的幻灯片切换。
    - **二次验证 (`enableDoubleVerification`)**：为减少因短暂遮挡（如鼠标指针、临时通知）导致的误判，启用此选项后，当检测到潜在切换时，系统会缓存当前帧。只有当后续连续 `VERIFICATION_COUNT` (默认 2) 帧与该缓存帧保持足够高的相似度（即 pHash 和 SSIM 均未再次触发切换条件）时，才最终确认该缓存帧为新的幻灯片。
- **配置管理**：自动保存用户设置，支持个性化参数调整
- **性能考量**：幻灯片提取（特别是帧图像对比分析阶段）是 **CPU 密集型** 任务。处理速度很大程度上取决于您计算机的 CPU 性能。应用已实现 **多核处理** 支持（默认启用，可在 `main.js` 中通过 `ENABLE_MULTI_CORE` 关闭），会尝试利用多个 CPU 核心来加速分析过程，尤其是在处理大量帧时效果更明显。

## 测试数据

在 M4 芯片的 Mac mini 上，以 2秒 为间隔处理标准三节课的约 2.5小时 的视频文件，约耗时 1分钟。

## 常见问题 FAQ

**Q1：支持哪些视频格式？**
A：支持 mp4、avi、mkv、mov、webm 等主流格式。

**Q2：如何提升幻灯片检测准确率？**
A：可适当调整检测间隔、选择更适合的视频对比算法，并开启二次验证。

**Q3：输出图片在哪里？**
A：默认在“下载”文件夹下的 `extracted` 目录，可在界面自定义输出路径。

**Q4：配置丢失怎么办？**
A：配置自动保存在用户数据目录，若异常可删除 `config.json` 重新设置。