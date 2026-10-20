# UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
#
# Shipped to the app through consumerProguardFiles. Only matters if a release build turns
# on minification: MediaPipe looks up its option, proto and result classes from JNI.
-keep class com.google.mediapipe.** { *; }
-dontwarn com.google.mediapipe.**
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.protobuf.**
-keepclasseswithmembernames class * {
    native <methods>;
}
