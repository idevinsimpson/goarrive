# NATIVE-CAMERA-1 — iOS API cross-check (Swift is UNCOMPILED)

No Swift compiler is available in the sprint sandbox (download.swift.org and Xcode are unreachable). This document stands in for a compile. It lists **every** external API the four Swift files in `apps/westayfit/modules/wsf-pose-camera/ios/` call, and for each one cites the exact public declaration and the rule that gives it the Swift spelling we use.

**This is not compile evidence.** It removes "the API does not exist / is spelled differently" as a first-build risk. It does not prove type-checking, linking or runtime behaviour. The Swift files also parse cleanly under the tree-sitter-swift 0.7.1 grammar (syntax only).

## Sources

| Label | What | Where it came from |
|---|---|---|
| **MP** | MediaPipe iOS headers at tag **v0.10.35** (`f8ef212d`), the version the podspec pins | `raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.35/…` |
| **MP-BUILD** | `mediapipe/tasks/ios/BUILD`, `MediaPipeTasks{Vision,Common}.podspec.template` at v0.10.35; CocoaPods trunk `MediaPipeTasksVision/0.10.35`, `MediaPipeTasksCommon/0.10.35` podspec JSON | same tag; `raw.githubusercontent.com/CocoaPods/Specs/master/Specs/…` |
| **EXPO** | `expo-modules-core` **3.0.30** iOS sources (the version SDK 54 installs) | `apps/westayfit/node_modules/expo-modules-core/ios/…` |
| **SDK18** | iPhoneOS **18.0** SDK headers, apinotes and swiftinterfaces | the **third-party** GitHub mirror `xybp888/iOS-SDKs` (`iPhoneOS18.0.sdk/…`), not Apple-hosted. Notification headers were also compared with its `iPhoneOS17.5/17.0/16.4.sdk` copies and `theos/sdks` `iPhoneOS16.5.sdk`. |

**How a Swift spelling is justified** (in order):

1. `NS_SWIFT_NAME(...)` in the header.
2. An apinotes `SwiftName:` entry.
3. A Swift overlay or swiftinterface declaration.
4. The Clang importer's standard rules: typed string enums drop their prefix; `getter=isX` BOOL properties import as `isX`; `init…:error:` imports as `init(…) throws`; trailing `error:` methods `throws`.

## MediaPipe (`import MediaPipeTasksVision`)

| Module fact | Evidence |
|---|---|
| The module name is `MediaPipeTasksVision` | MP-BUILD trunk podspec JSON: `"module_name": "MediaPipeTasksVision"`, `static_framework: true`, iOS 15.0, `vendored_frameworks: frameworks/MediaPipeTasksVision.xcframework`. |
| All headers used below are **public headers of that framework** (so one `import` suffices; no `import MediaPipeTasksCommon` needed) | MP-BUILD `BUILD:286–343` `MediaPipeTasksVision_framework.public_hdrs` lists `MPPBaseOptions.h`, `MPPLandmark.h`, `MPPTaskOptions.h`, `MPPImage.h`, `MPPRunningMode.h`, `MPPPoseLandmarker.h`, `MPPPoseLandmarkerOptions.h`, `MPPPoseLandmarkerResult.h`. |

| Swift use (file:line) | Declared at (MP, v0.10.35) | Declaration | Swift spelling | Status |
|---|---|---|---|---|
| `PoseLandmarkerOptions()` WsfPoseModel.swift:53 | `vision/pose_landmarker/sources/MPPPoseLandmarkerOptions.h:59` | `NS_SWIFT_NAME(PoseLandmarkerOptions) @interface MPPPoseLandmarkerOptions : MPPTaskOptions` | NS_SWIFT_NAME; `init` inherited | ✓ |
| `options.baseOptions` :54–55 | `core/sources/MPPTaskOptions.h:30` | `@property(nonatomic, copy) MPPBaseOptions *baseOptions;` | property | ✓ (the `copy` setter is not used; we mutate the returned object, as the getter returns the stored instance) |
| `.modelAssetPath = path` :54 | `core/sources/MPPBaseOptions.h:36` | `@property(nonatomic, copy) NSString *modelAssetPath;` | property | ✓ |
| `.delegate = delegate`; `Delegate`, `.GPU`, `.CPU` :52,55,65,67 | `core/sources/MPPBaseOptions.h:21–24,39` | `typedef NS_ENUM(NSUInteger, MPPDelegate) { MPPDelegateCPU, MPPDelegateGPU } NS_SWIFT_NAME(Delegate);` `@property(nonatomic) MPPDelegate delegate;` | NS_SWIFT_NAME; enum cases drop the common prefix (`MPPDelegate`) → `.CPU`, `.GPU` | ✓ |
| `options.runningMode = .video` :56 | `vision/pose_landmarker/sources/MPPPoseLandmarkerOptions.h:70`; `vision/core/sources/MPPRunningMode.h:31,39` | `@property MPPRunningMode runningMode;` / `MPPRunningModeVideo` / `NS_SWIFT_NAME(RunningMode)` | prefix drop → `.video` | ✓ |
| `options.numPoses = maxPoses` (Int) :57 | `…Options.h:82` | `@property(nonatomic) NSInteger numPoses;` | NSInteger → Int | ✓ |
| `minPoseDetectionConfidence`, `minPosePresenceConfidence`, `minTrackingConfidence` = Float 0.5 :58–60 | `…Options.h:87,93,98` | `@property(nonatomic) float …;` | float → Float | ✓ |
| `options.shouldOutputSegmentationMasks = false` :61 | `…Options.h:103` | `@property(nonatomic) BOOL shouldOutputSegmentationMasks;` | BOOL → Bool | ✓ |
| `try PoseLandmarker(options:)` :62 | `vision/pose_landmarker/sources/MPPPoseLandmarker.h:29,59–60` | `NS_SWIFT_NAME(PoseLandmarker)`; `- (nullable instancetype)initWithOptions:(MPPPoseLandmarkerOptions *)options error:(NSError **)error` | `init…:error:` → `init(options:) throws` | ✓ |
| `try landmarker.detect(videoFrame:timestampInMilliseconds:)` (Int) WsfPoseRun.swift:209 | `MPPPoseLandmarker.h:111–114` | `- (nullable MPPPoseLandmarkerResult *)detectVideoFrame:(MPPImage *)image timestampInMilliseconds:(NSInteger)… error:(NSError **)error NS_SWIFT_NAME(detect(videoFrame:timestampInMilliseconds:));` | NS_SWIFT_NAME; trailing `error:` → `throws`, non-optional result | ✓ |
| `try MPImage(sampleBuffer:orientation: .up)` :208 | `vision/core/sources/MPPImage.h:33,174–176` | `NS_SWIFT_NAME(MPImage)`; `- (nullable instancetype)initWithSampleBuffer:(CMSampleBufferRef)sampleBuffer orientation:(UIImageOrientation)orientation error:(NSError **)error` | `init(sampleBuffer:orientation:) throws`. The header says the buffer must be pixel-buffer based (camera output). MediaPipe needs 32BGRA, which the output is set to. | ✓ |
| `PoseLandmarkerResult`, `result.landmarks` → `[[NormalizedLandmark]]` :206,215 | `vision/pose_landmarker/sources/MPPPoseLandmarkerResult.h:23,27` | `NS_SWIFT_NAME(PoseLandmarkerResult)`; `NSArray<NSArray<MPPNormalizedLandmark *> *> *landmarks;` | lightweight generics → `[[NormalizedLandmark]]` | ✓ |
| `NormalizedLandmark`, `.x`, `.y` (Float), `.visibility` (`NSNumber?`) WsfPoseModel.swift:76–82 | `components/containers/sources/MPPLandmark.h:78,82,85,96` | `NS_SWIFT_NAME(NormalizedLandmark)`; `float x; float y; nullable NSNumber *visibility;` | NSNumber? → `.map { $0.doubleValue }` | ✓ |

**Linking (not a Swift API, but the top first-build risk):** `MediaPipeTasksCommon` 0.10.35 sets `user_target_xcconfig OTHER_LDFLAGS[sdk=iphoneos*] = -force_load "$(PODS_ROOT)/MediaPipeTasksCommon/frameworks/graph_libraries/libMediaPipeTasksCommon_device_graph.a"` (MP-BUILD trunk JSON). It also links `Accelerate, CoreMedia, AssetsLibrary, CoreFoundation, CoreGraphics, CoreImage, QuartzCore, AVFoundation, CoreVideo` and `c++`. If the force-load is lost in the Expo Podfile, the graph is not registered and the landmarker fails at runtime. In the app that shows as the `model` failure panel.

## Expo Modules (`import ExpoModulesCore`, expo-modules-core 3.0.30)

| Swift use (file:line) | Declared at (EXPO) | Declaration | Status |
|---|---|---|---|
| `public class WsfPoseCameraModule: Module` WsfPoseCameraModule.swift:9 | `Core/Modules/Module.swift:8,29`; `Core/Protocols/AnyModule.swift:16` | `open class BaseModule`; `public typealias Module = AnyModule & BaseModule`; `func definition() -> ModuleDefinition` | ✓ |
| `public func definition() -> ModuleDefinition` :10 (result builder) | `Core/Modules/ModuleDefinitionBuilder.swift:5–6`; `Core/Modules/ModuleDefinition.swift:8` | `@resultBuilder public struct ModuleDefinitionBuilder`; `public final class ModuleDefinition` | ✓ |
| `Name("WsfPoseCamera")` :11 | `Api/Factories/ModuleFactories.swift:4` | `public func Name(_ name: String) -> AnyDefinition` | ✓ |
| `AsyncFunction("getCameraPermissionAsync") { () -> [String: Any] in … }` :13 | `Api/Factories/AsyncFunctionFactories.swift:4–14` | `public func AsyncFunction<R>(_ name: String, _ closure: @escaping () throws -> R)` | ✓ |
| `AsyncFunction("requestCameraPermissionAsync") { (promise: Promise) in … }` :17 | `Api/Factories/AsyncFunctionFactories.swift:19–29`; `Core/Functions/AsyncFunctionDefinition.swift:49`; `Core/Promise.swift:3,21` | variadic-generic `AsyncFunction<R, A0: AnyArgument, each A: AnyArgument>` (needs Swift ≥ 5.9; the podspec sets `swift_version 5.9`); `takesPromise = dynamicArgumentTypes.last?.wraps(Promise.self)`; `public struct Promise: AnyArgument`, `public func resolve(_ value: Any? = nil)` | ✓ (a last `Promise` argument is injected, not passed from JS) |
| `View(WsfPoseCameraView.self) { … }` :28 | `Api/Factories/ViewFactories.swift:10–15` | `public func View<ViewType: UIView>(_ viewType: ViewType.Type, @ViewDefinitionBuilder<ViewType> _ elements: …)` | ✓ |
| `Events("onCameraReady", "onPose", "onCameraError", "onCameraInterrupted")` inside `View` :29 | `Api/Factories/ObjectFactories.swift:33`; `Api/Builders/ViewDefinitionBuilder.swift:13` | `public func Events(_ names: String...) -> EventsDefinition`; `buildExpression(_ element: EventsDefinition)` | ✓ |
| `Prop("active") { (view: WsfPoseCameraView, active: Bool) in }`, `Prop("runId") { (…, runId: Int) in }` :31,35 | `Api/Factories/ViewFactories.swift:38`; `Api/Builders/ViewDefinitionBuilder.swift:27`; `Core/Arguments/AnyArgument.swift:17,19` | `public func Prop<ViewType: UIView, PropType: AnyArgument>(_ name: String, _ setter: @escaping (ViewType, PropType) -> Void)`; `extension Bool: AnyArgument {}`; `extension Int: AnyArgument` | ✓ |
| `OnViewDidUpdateProps { (view: WsfPoseCameraView) in view.applyProps() }` :39 | `Api/Factories/ViewFactories.swift:70`; `Api/Builders/ViewDefinitionBuilder.swift:34`; `Core/Views/ViewDefinition.swift:85` | `public func OnViewDidUpdateProps<ViewType: UIView>(_ closure: @escaping (_ view: ViewType) -> Void) -> ViewLifecycleMethod<ViewType>` | ✓ |
| `final class WsfPoseCameraView: ExpoView`; `required init(appContext: AppContext? = nil)` WsfPoseCameraView.swift:14,26 | `Core/Views/ExpoView.swift:6` (new arch: `public typealias ExpoView = ExpoFabricView`), `:43` (old arch); `Fabric/ExpoFabricView.swift:43,69–70,133`; `Core/AppContext.swift:7` | `required public init(appContext: AppContext? = nil)`. `@available(*, unavailable) public required init?(coder:)` lets subclasses skip it. `shouldBeRecycled() -> false`. `public final class AppContext` | ✓ (`newArchEnabled: true` → ExpoFabricView) |
| `let onPose = EventDispatcher()` (×4) and `onPose(payload)` with `[String: Any]` WsfPoseCameraView.swift:15–18 | `Core/Events/EventDispatcher.swift:6,30,39` | `public final class EventDispatcher`; `public init(_ customName: String? = nil)`; `public func callAsFunction(_ payload: [String: Any])`. Dispatchers are matched to `Events(...)` names by property label (`:65–89`) | ✓ (the property names equal the event names) |

## AVFoundation (iPhoneOS 18.0 SDK, third-party mirror)

| Swift use (file:line) | Declared at (SDK18 `AVFoundation.framework/Headers/…`) | Declaration | Swift spelling | Status |
|---|---|---|---|---|
| `AVCaptureDevice.authorizationStatus(for: .video)` WsfPoseCameraModule.swift:14,18; WsfPoseRun.swift:64 | `AVCaptureDevice.h:1906` | `+ (AVAuthorizationStatus)authorizationStatusForMediaType:(AVMediaType)mediaType` | apinotes `AVFoundation.apinotes:192–193` `SwiftName: 'authorizationStatus(for:)'` | ✓ |
| `AVCaptureDevice.requestAccess(for: .video) { granted in }` :23 | `AVCaptureDevice.h:1929` | `+ (void)requestAccessForMediaType:(AVMediaType)mediaType completionHandler:(void (^)(BOOL granted))handler` | apinotes `:207–208` `requestAccess(for:completionHandler:)` | ✓ |
| `.authorized`, `.notDetermined`, `.denied` (AVAuthorizationStatus) | `AVCaptureDevice.h:1882–1886` | `typedef NS_ENUM(NSInteger, AVAuthorizationStatus) { …NotDetermined = 0, … Authorized = 3 }` | prefix drop | ✓ |
| `.video` (AVMediaType) | `AVMediaFormat.h:15,17` | `typedef NSString * AVMediaType NS_EXTENSIBLE_STRING_ENUM;` `AVMediaTypeVideo` | typed-enum prefix drop → `.video` | ✓ |
| `AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)` WsfPoseRun.swift:142 | `AVCaptureDevice.h:632`, `:453,478`, `:421–427` | `+ (nullable AVCaptureDevice *)defaultDeviceWithDeviceType:mediaType:position:`; `typedef NSString *AVCaptureDeviceType NS_TYPED_ENUM` / `AVCaptureDeviceTypeBuiltInWideAngleCamera`; `AVCaptureDevicePositionFront = 2` | apinotes `:198–199` `default(_:for:position:)`; typed-enum prefix drop | ✓ |
| `try AVCaptureDeviceInput(device:)` :145 | `AVCaptureInput.h:219` | `- (nullable instancetype)initWithDevice:(AVCaptureDevice *)device error:(NSError **)outError` | `init(device:) throws` | ✓ |
| `AVCaptureSession()`; `beginConfiguration` / `commitConfiguration` :35,94,101,136–137 | `AVCaptureSession.h:165,497,507` | `@interface AVCaptureSession : NSObject`; `- (void)beginConfiguration;` `- (void)commitConfiguration;` | — | ✓ |
| `canSetSessionPreset(.vga640x480)`, `sessionPreset = .vga640x480` :139–140 | `AVCaptureSession.h:184`; `AVCaptureSessionPreset.h:21,91` | `- (BOOL)canSetSessionPreset:(AVCaptureSessionPreset)preset`; `AVCaptureSessionPreset640x480` | apinotes `:946–947` `SwiftName: vga640x480` | ✓ |
| `canAddInput`/`addInput`/`removeInput`/`inputs`; `canAddOutput`/`addOutput`/`removeOutput`/`outputs` :95–99,146–154 | `AVCaptureSession.h:204,219,232,245,255,276,289,302` | `NSArray<__kindof AVCaptureInput *> *inputs`, `- (BOOL)canAddInput:` … `- (void)removeOutput:` | — | ✓ |
| `startRunning()`, `stopRunning()`, `isRunning` :91–92,119,121 | `AVCaptureSession.h:517,613,623` | `@property(readonly, getter=isRunning) BOOL running;` `- (void)startRunning;` `- (void)stopRunning;` | getter rule → `isRunning` | ✓ |
| `AVCaptureVideoDataOutput()`; `videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]`; `alwaysDiscardsLateVideoFrames = true` :36,150–151 | `AVCaptureVideoDataOutput.h:89,223` | `@property(nonatomic, copy, null_resettable) NSDictionary<NSString *, id> *videoSettings;` `@property(nonatomic) BOOL alwaysDiscardsLateVideoFrames;` | `[String: Any]` | ✓ |
| `setSampleBufferDelegate(self, queue:)` / `(nil, queue: nil)` :90,152 | `AVCaptureVideoDataOutput.h:57` | `- (void)setSampleBufferDelegate:(nullable id<…>)sampleBufferDelegate queue:(nullable dispatch_queue_t)…` (the header says nil queue is allowed only with a nil delegate) | — | ✓ |
| `func captureOutput(_:didOutput:from:)` (conformance to `AVCaptureVideoDataOutputSampleBufferDelegate`) :30,190 | `AVCaptureVideoDataOutput.h:277` | `- (void)captureOutput:(AVCaptureOutput *)output didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer fromConnection:(AVCaptureConnection *)connection;` | apinotes `:726–729` `SwiftName: 'captureOutput(_:didOutput:from:)'` | ✓ |
| `output.connection(with: .video)` :156 | `AVCaptureOutputBase.h:64` | `- (nullable AVCaptureConnection *)connectionWithMediaType:(AVMediaType)mediaType` | apinotes `:272–273` `connection(with:)` | ✓ |
| `isVideoMirroringSupported`, `automaticallyAdjustsVideoMirroring = false`, `isVideoMirrored = false` :158–161 | `AVCaptureSession.h:989,999,1009` | `@property(readonly, getter=isVideoMirroringSupported) BOOL supportsVideoMirroring;` `@property(getter=isVideoMirrored) BOOL videoMirrored;` `@property BOOL automaticallyAdjustsVideoMirroring;` | getter rule | ✓ |
| `isVideoRotationAngleSupported(90)`, `videoRotationAngle = 90` (inside `#available(iOS 17.0, *)`) :168–169 | `AVCaptureSession.h:1024,1036` | `- (BOOL)isVideoRotationAngleSupported:(CGFloat)videoRotationAngle;` `@property CGFloat videoRotationAngle API_AVAILABLE(ios(17.0))` | — ; availability guarded | ✓ (needs the iOS 17+ SDK: Xcode 15+) |
| `isVideoOrientationSupported`, `videoOrientation = .portrait` (iOS < 17 branch) :171–172 | `AVCaptureSession.h:1046,1056` | `getter=isVideoOrientationSupported … API_DEPRECATED(ios(4.0, 17.0))`; `AVCaptureVideoOrientation videoOrientation API_DEPRECATED(ios(4.0, 17.0))` | getter rule | ✓ (deprecated, not removed) |
| `AVCaptureVideoPreviewLayer()`, `.session`, `.videoGravity = .resizeAspectFill`, `.connection` WsfPoseCameraView.swift:23,30,87; WsfPoseRun.swift:68,126 | `AVCaptureVideoPreviewLayer.h:33,95,115,125`; `AVAnimation.h:23,40` | `@interface AVCaptureVideoPreviewLayer : CALayer` (CALayer `init`); `@property(retain, nullable) AVCaptureSession *session;` `@property(readonly, nullable) AVCaptureConnection *connection;` `@property(copy) AVLayerVideoGravity videoGravity;` `typedef NSString * AVLayerVideoGravity NS_STRING_ENUM;` `AVLayerVideoGravityResizeAspectFill` | string-enum prefix drop → `.resizeAspectFill` | ✓ |
| Session notifications observed by **string**: `Notification.Name("AVCaptureSessionWasInterruptedNotification")`, `("AVCaptureSessionRuntimeErrorNotification")`; userInfo keys `"AVCaptureSessionInterruptionReasonKey"`, `"AVCaptureSessionErrorKey"` WsfPoseRun.swift:230–244 | `AVCaptureSession.h:26,36,68,104` (18.0) | 18.0: `NSNotificationName const AVCaptureSessionRuntimeErrorNotification NS_SWIFT_NAME(AVCaptureSession.runtimeErrorNotification)`, `… AVCaptureSessionWasInterruptedNotification NS_SWIFT_NAME(AVCaptureSession.wasInterruptedNotification)`. The 17.5/17.0/16.4/16.5 copies declare `NSString *const …` **without** that name. No apinotes compatibility alias. | Strings are used on purpose: **the Swift spelling differs by SDK generation**, so a Swift constant would compile under only one of them. | Symbol ✓. **String VALUES UNVERIFIED**: headers do not carry constant values. They follow Apple's convention (value = symbol name). If wrong, these observers never fire. JS still pauses on AppState, and AVFoundation stops the session itself. |

## CoreMedia, CoreVideo, UIKit, Foundation, CryptoKit

| Swift use (file:line) | Declared at (SDK18) | Declaration | Swift spelling | Status |
|---|---|---|---|---|
| `CMSampleBufferGetPresentationTimeStamp(sampleBuffer)` WsfPoseRun.swift:193 | `CoreMedia.framework/Headers/CMSampleBuffer.h:1229` | `CMTime CMSampleBufferGetPresentationTimeStamp(CMSampleBufferRef sbuf)` | `CoreMedia.apinotes:343–344` | ✓ |
| `pts.isValid`, `pts.isNumeric` :194 | `usr/lib/swift/CoreMedia.swiftmodule/arm64e-apple-ios.swiftinterface:1829,1831,1847` | `extension CoreMedia.CMTime { public var isValid: Swift.Bool …; public var isNumeric: Swift.Bool … }` | Swift overlay | ✓ |
| `CMTimeGetSeconds(pts)` :195 | `CoreMedia.framework/Headers/CMTime.h:243` | `Float64 CMTimeGetSeconds(CMTime time)` | Double | ✓ |
| `CMSampleBufferGetImageBuffer(sampleBuffer)` :202 | `CMSampleBuffer.h:828` | `CVImageBufferRef CM_NULLABLE CMSampleBufferGetImageBuffer(…)` | `CoreMedia.apinotes:307–308`; nullable → `guard let` | ✓ |
| `CVPixelBufferGetWidth/Height(pixels)` :203–204 | `CoreVideo.framework/Headers/CVPixelBuffer.h:484,492` | `size_t CVPixelBufferGetWidth(CVPixelBufferRef)` | size_t → Int | ✓ |
| `kCVPixelBufferPixelFormatTypeKey as String`, `kCVPixelFormatType_32BGRA` :150 | `CVPixelBuffer.h:227,56` | `const CFStringRef kCVPixelBufferPixelFormatTypeKey`; `kCVPixelFormatType_32BGRA = 'BGRA'` | CFString → `as String`; OSType boxed to NSNumber | ✓ |
| `orientation: .up` (UIImage.Orientation) :208 | `UIKit.framework/Headers/UIImage.h:39` | `UIImageOrientationUp` | prefix drop | ✓ |
| `Bundle(for:)`, `Bundle.main`, `url(forResource:withExtension:)`, `Bundle(url:)`, `path(forResource:ofType:)` WsfPoseModel.swift:28–34 | `Foundation.framework/Headers/NSBundle.h:31,23,77,29,87` | `+bundleForClass:`, `mainBundle`, `-URLForResource:withExtension:`, `-initWithURL:` (nullable), `-pathForResource:ofType:` | importer rules (`init(for:)`, failable `init?(url:)`) | ✓ |
| `Data(contentsOf: URL(fileURLWithPath:), options: .mappedIfSafe)` :44 | `NSData.h:15,118` (the ObjC side: `NSDataReadingMappedIfSafe`, `-initWithContentsOfURL:options:error:`) | Swift `Data`/`URL` initialisers live in swift-foundation (FoundationEssentials); that interface is **not** in the mirror | — | **UNVERIFIED** from the SDK here (a long-standing Swift Foundation API) |
| `String(format: "%02x", $0)` :45 | `Foundation.framework/Modules/Foundation.swiftmodule/arm64e-apple-ios.swiftinterface:11604` | `public init(format: __shared Swift.String, _ arguments: any Swift.CVarArg...)` | Swift overlay | ✓ |
| `NotificationCenter.default.addObserver(forName:object:queue:)` + trailing closure; `removeObserver(_:)`; `Notification.Name(String)` WsfPoseRun.swift:83,237–244 | `NSNotification.h:7,47,51` | `typedef NSString *NSNotificationName NS_TYPED_EXTENSIBLE_ENUM;` `-removeObserver:`; `-addObserverForName:object:queue:usingBlock:` | extensible enum → `NSNotification.Name(_:)`; `using:` block | ✓ |
| `SHA256.hash(data: data)` → `.map` over bytes WsfPoseModel.swift:45 | `CryptoKit.framework/Modules/CryptoKit.swiftmodule/arm64e-apple-ios.swiftinterface:224,347,665,1288,139` | `public struct SHA256`; `public static func hash<D>(data: D) -> Self.Digest where D : DataProtocol`; `SHA256Digest : CryptoKit.Digest`; `protocol Digest : …, Swift.Sequence where Element == UInt8` | Swift-only framework | ✓ |

## What this does not cover (still for the first EAS build)

- **Type-checking, overload resolution, linking and runtime.** For example: the result-builder inference of the Expo DSL, the `MediaPipeTasksCommon` force-load, the resource-bundle path, and behaviour on a device.
- **The SDK actually used by EAS.** This is checked against the iOS 18.0 headers (and 16.4–17.5 for the notification names). Expo SDK 54 builds with Xcode 16 or later (iOS 18+ SDK). An iOS 26 SDK could deprecate further APIs; deprecation is a warning, not an error.
- **The string values of the AVCaptureSession notification constants** (above).
- **`Data(contentsOf:options:)` / `URL(fileURLWithPath:)`**: the swift-foundation interface was not available in the mirror.
