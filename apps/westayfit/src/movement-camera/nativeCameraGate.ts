/**
 * THE TELEMETRY GATE — reviewed approval required. Keep this `false`.
 *
 * Its own file so the two native places that read it (support.native.ts, which
 * decides whether the camera entry is offered, and controller.native.ts, which
 * refuses to ask for the camera) share one constant, and tests can cover both
 * states through the real code. Only `.native` files import it: the web bundle
 * never contains it.
 *
 * Independent review of #638 (blocking finding 1 / F1, at abe84f45; the
 * Android list completed by the delta review at 3edaf5f5) found that the
 * MediaPipe Tasks native SDKs the module links send Google usage telemetry
 * whenever a pose landmarker is created and while it runs:
 *
 *  - iOS: MediaPipeTasksCommon 0.10.35 links ClearcutLoggingClient and posts
 *    to play.googleapis.com/log. What MediaPipe hands its logger
 *    (MPPTaskRunner.mm, task_runner.cc, tasks_logger.h at v0.10.35): task
 *    name, running mode, host system (iOS), iOS version, bundle id and app
 *    version; session start, clone and end; CPU/GPU input, finished and
 *    dropped frame counts; total and peak latency; elapsed time; init errors.
 *    What the Clearcut client itself adds to each request on iOS is NOT
 *    confirmed: the review found no UIDevice, sysctl, NSLocale or
 *    CoreTelephony reference in the Clearcut objects, but nobody decoded an
 *    upload.
 *  - Android: tasks-core 0.10.29 (and 0.10.35) sends through
 *    com.google.android.datatransport (RemoteLoggingClient, CCT backend),
 *    which queues each event on the device and uploads it later. MediaPipe's
 *    own fields (TasksStatsProtoLogger): package name, versionCode and
 *    platform; task name, event name and running mode; session start, clone
 *    and end with init latency; invocation counts by input type, dropped
 *    count, elapsed time, average and peak latency; error code. MediaPipe
 *    itself does not read the OS version. DataTransport's CCT backend
 *    (CctTransportBackend.decorate, checked in transport-backend-cct 4.0.0.5)
 *    adds to every queued event: device model, manufacturer, hardware, device
 *    and product names, build fingerprint, OS build id and SDK version,
 *    locale and country, SIM MCC/MNC, network type and mobile subtype,
 *    timezone offset, the app build number, and the event's wall-clock and
 *    uptime timestamps.
 *  - Both: each upload reaches Google from the device's IP address.
 *
 * No camera frames, images or landmarks are sent. Turning the native camera on
 * would still be expanded data collection, which this sprint does not
 * authorize. The decision (A: accept and disclose, or B: build telemetry-free
 * binaries) is the owner's; see docs/westayfit/qa/move-camera-native-adapter-1.md.
 *
 * Changing this to `true` is a privacy decision: it needs the owner's recorded
 * approval and a review, and must not be done to make a build "work".
 */
export const NATIVE_CAMERA_TELEMETRY_APPROVED: boolean = false;
