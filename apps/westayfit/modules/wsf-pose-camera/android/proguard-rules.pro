# UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
#
# Shipped to the app through consumerProguardFiles. Only matters if a release build turns
# on minification: MediaPipe looks up its option, proto and result classes from JNI.
-keep class com.google.mediapipe.** { *; }
-dontwarn com.google.mediapipe.**
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.protobuf.**

# MediaPipe's Graph static initializer finds its caller through Flogger; R8 renaming breaks that
# ("no caller found on the stack" inside ExceptionInInitializerError).
-keep class com.google.common.flogger.** { *; }
-dontwarn com.google.common.flogger.**
-keepclasseswithmembernames class * {
    native <methods>;
}
