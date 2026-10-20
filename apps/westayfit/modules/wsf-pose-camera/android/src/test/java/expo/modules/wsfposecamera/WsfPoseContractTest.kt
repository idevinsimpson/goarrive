// UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
//
// Exception for THIS file: a plain-JVM test runner (main + its own asserts and a tiny JSON
// reader/writer; no JUnit, no Android) for WsfPoseContract.kt. The sprint sandbox compiles and
// runs it with kotlinc 2.1.20 — see docs/westayfit/qa/camera-evidence/run-kotlin-jvm.sh.
//
//   args: <model .task> <android/build.gradle> <input stream .json> <output events .json>
//
// Besides unit tests, it plays a recorded landmark stream (tests/fixtures/native-camera/
// landmark-stream.json) through exactly what WsfPoseRun.analyze does with MediaPipe's output —
// WsfFrameClock.accept, WsfPoseContract.people and posePayload, plus the runId send() adds — and
// writes the resulting onPose events. tests/move-camera-native-contract.test.ts feeds those events
// through the JS adapter and the real frozen session and checks them against the JS reference.
package expo.modules.wsfposecamera

import java.io.File
import java.nio.ByteBuffer
import kotlin.system.exitProcess

private class Checks {
  private var failed = 0
  private var passed = 0

  fun run(name: String, body: () -> Unit) {
    try {
      body()
      passed += 1
      println("PASS $name")
    } catch (error: Throwable) {
      failed += 1
      println("FAIL $name: ${error.message}")
    }
  }

  fun finish() {
    println("kotlin-jvm: $passed passed, $failed failed")
    if (failed > 0) exitProcess(1)
  }
}

private fun <T> eq(expected: T, actual: T, what: String = "") {
  if (expected != actual) throw AssertionError("$what expected <$expected> but was <$actual>")
}

private fun truth(cond: Boolean, what: String) {
  if (!cond) throw AssertionError(what)
}

private inline fun <reified E : Throwable> throws(what: String, body: () -> Unit) {
  try {
    body()
  } catch (error: Throwable) {
    if (error is E) return
    throw AssertionError("$what threw ${error::class.java.name}, not ${E::class.java.name}")
  }
  throw AssertionError("$what did not throw")
}

// ── A minimal JSON reader / writer (the fixtures only use objects, arrays, numbers, strings, null, booleans) ──

private class JsonReader(private val s: String) {
  private var i = 0

  fun parse(): Any? {
    val v = value()
    ws()
    check(i == s.length) { "trailing data at $i" }
    return v
  }

  private fun ws() {
    while (i < s.length && s[i].isWhitespace()) i += 1
  }

  private fun value(): Any? {
    ws()
    return when (s[i]) {
      '{' -> obj()
      '[' -> arr()
      '"' -> str()
      't' -> lit("true", true)
      'f' -> lit("false", false)
      'n' -> lit("null", null)
      else -> num()
    }
  }

  private fun lit(word: String, v: Any?): Any? {
    check(s.startsWith(word, i)) { "bad literal at $i" }
    i += word.length
    return v
  }

  private fun obj(): Map<String, Any?> {
    i += 1
    val m = LinkedHashMap<String, Any?>()
    ws()
    if (s[i] == '}') { i += 1; return m }
    while (true) {
      ws()
      val k = str()
      ws()
      check(s[i] == ':') { "expected : at $i" }
      i += 1
      m[k] = value()
      ws()
      if (s[i] == ',') { i += 1; continue }
      check(s[i] == '}') { "expected } at $i" }
      i += 1
      return m
    }
  }

  private fun arr(): List<Any?> {
    i += 1
    val l = ArrayList<Any?>()
    ws()
    if (s[i] == ']') { i += 1; return l }
    while (true) {
      l.add(value())
      ws()
      if (s[i] == ',') { i += 1; continue }
      check(s[i] == ']') { "expected ] at $i" }
      i += 1
      return l
    }
  }

  private fun str(): String {
    check(s[i] == '"') { "expected string at $i" }
    i += 1
    val sb = StringBuilder()
    while (s[i] != '"') {
      val c = s[i]
      i += 1
      if (c != '\\') { sb.append(c); continue }
      val e = s[i]
      i += 1
      when (e) {
        'n' -> sb.append('\n')
        't' -> sb.append('\t')
        'u' -> { sb.append(s.substring(i, i + 4).toInt(16).toChar()); i += 4 }
        else -> sb.append(e)
      }
    }
    i += 1
    return sb.toString()
  }

  private fun num(): Any {
    val start = i
    while (i < s.length && (s[i].isDigit() || s[i] in "+-.eE")) i += 1
    val t = s.substring(start, i)
    return if (t.any { it in ".eE" }) t.toDouble() else t.toLong()
  }
}

private fun writeJson(v: Any?, sb: StringBuilder) {
  when (v) {
    null -> sb.append("null")
    is String -> {
      sb.append('"')
      for (c in v) {
        when (c) {
          '"' -> sb.append("\\\"")
          '\\' -> sb.append("\\\\")
          '\n' -> sb.append("\\n")
          else -> sb.append(c)
        }
      }
      sb.append('"')
    }
    is Boolean -> sb.append(v)
    is Double -> { check(v.isFinite()) { "non-finite number" }; sb.append(v.toString()) }
    is Int, is Long -> sb.append(v.toString())
    is Map<*, *> -> {
      sb.append('{')
      var first = true
      for ((k, value) in v.entries.sortedBy { it.key as String }) {
        if (!first) sb.append(',')
        first = false
        writeJson(k as String, sb)
        sb.append(':')
        writeJson(value, sb)
      }
      sb.append('}')
    }
    is List<*> -> {
      sb.append('[')
      v.forEachIndexed { index, item ->
        if (index > 0) sb.append(',')
        writeJson(item, sb)
      }
      sb.append(']')
    }
    else -> throw IllegalArgumentException("cannot write ${v::class.java.name}")
  }
}

private fun json(v: Any?): String = StringBuilder().also { writeJson(v, it) }.toString()

private fun landmarksOf(person: List<*>): List<WsfLandmark> = person.map { raw ->
  val l = raw as List<*>
  WsfLandmark((l[0] as Number).toFloat(), (l[1] as Number).toFloat(), (l[2] as Number?)?.toFloat())
}

fun main(args: Array<String>) {
  check(args.size == 4) { "usage: <model.task> <build.gradle> <input.json> <output.json>" }
  val (modelPath, gradlePath, inputPath, outputPath) = args
  val c = Checks()

  c.run("nsToMs truncates nanoseconds to whole milliseconds") {
    eq(0L, WsfPoseContract.nsToMs(999_999L))
    eq(1L, WsfPoseContract.nsToMs(1_000_000L))
    eq(259_200_033L, WsfPoseContract.nsToMs(259_200_033_000_437L))
    eq(259_200_033L, WsfPoseContract.nsToMs(259_200_033_999_999L))
  }

  c.run("frame clock: the first frame is taken; repeated, same-ms and older frames are dropped, never re-timed") {
    val clock = WsfFrameClock()
    eq(100L, clock.accept(100_000_000L))
    eq(null, clock.accept(100_000_000L), "repeat")
    eq(null, clock.accept(100_400_000L), "same ms")
    eq(null, clock.accept(99_000_000L), "older")
    eq(133L, clock.accept(133_333_333L))
    eq(166L, clock.accept(166_666_666L))
    eq(null, clock.accept(150_000_000L), "older again")
    eq(0L, WsfFrameClock().accept(0L), "a fresh clock takes timestamp 0")
  }

  c.run("rotation is normalised to 0/90/180/270") {
    eq(listOf(0, 90, 180, 270, 0, 270, 90), listOf(0, 90, 180, 270, 360, -90, 450).map { WsfPoseContract.normalizedRotation(it) })
  }

  c.run("flatten: x, y are MediaPipe's Floats widened to Double; a missing visibility is -1") {
    val flat = WsfPoseContract.flatten(listOf(WsfLandmark(0.1f, 0.25f, 0.9f), WsfLandmark(0.5f, 1.2f, null)))
    eq(listOf(0.1f.toDouble(), 0.25, 0.9f.toDouble(), 0.5, 1.2f.toDouble(), -1.0), flat)
    eq(0.10000000149011612, flat[0], "float widening")
    eq(-1.0, WsfPoseContract.NO_VISIBILITY)
  }

  c.run("people: at most MAX_POSES (3) in MediaPipe's order; nobody gives an empty list") {
    val person = { x: Float -> listOf(WsfLandmark(x, 0.5f, 1f)) }
    eq(3, WsfPoseContract.MAX_POSES)
    val four = WsfPoseContract.people(listOf(person(0.1f), person(0.2f), person(0.3f), person(0.4f)))
    eq(3, four.size)
    eq(listOf(0.1f.toDouble(), 0.2f.toDouble(), 0.3f.toDouble()), four.map { it[0] })
    eq(emptyList<List<Double>>(), WsfPoseContract.people(emptyList()))
  }

  c.run("posePayload: exactly the keys and types the JS contract reads") {
    val p = WsfPoseContract.posePayload(259_200_033_000_437L, 480, 640, listOf(listOf(0.5, 0.25, -1.0)))
    eq(setOf("timestamp", "timestampUnit", "width", "height", "mirrored", "people"), p.keys)
    eq(259_200_033_000_437.0, p["timestamp"])
    truth(p["timestamp"] is Double, "timestamp is a Double (Long is not sent)")
    eq("ns", p["timestampUnit"])
    eq(480, p["width"])
    eq(640, p["height"])
    eq(false, p["mirrored"])
    eq(listOf(listOf(0.5, 0.25, -1.0)), p["people"])
  }

  c.run("engine id names the Android MediaPipe version and numPoses") {
    eq("mediapipe-tasks-vision@0.10.29 pose_landmarker_lite (GPU, numPoses=3) android", WsfPoseContract.engine("GPU"))
    eq(0.5f, WsfPoseContract.MIN_CONFIDENCE)
  }

  c.run("sha256: the FIPS 180-2 'abc' vector, and the bundled model is the pinned web model") {
    eq("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", WsfPoseContract.sha256Hex("abc".toByteArray()))
    eq(WsfPoseContract.MODEL_SHA256, WsfPoseContract.sha256Hex(File(modelPath).readBytes()))
    eq("pose_landmarker_lite.task", File(modelPath).name)
    eq(WsfPoseContract.MODEL_FILE, File(modelPath).name)
  }

  c.run("verifiedModelBuffer: a direct buffer at position 0 with the whole model; any other bytes are refused") {
    val bytes = File(modelPath).readBytes()
    val buffer: ByteBuffer = WsfPoseContract.verifiedModelBuffer(bytes)
    truth(buffer.isDirect, "direct buffer (MediaPipe requires direct or mapped)")
    eq(0, buffer.position())
    eq(bytes.size, buffer.limit())
    val copy = ByteArray(bytes.size)
    buffer.duplicate().get(copy)
    truth(copy.contentEquals(bytes), "same bytes")
    val tampered = bytes.copyOf().also { it[100] = (it[100] + 1).toByte() }
    throws<IllegalStateException>("tampered model") { WsfPoseContract.verifiedModelBuffer(tampered) }
    throws<IllegalStateException>("empty model") { WsfPoseContract.verifiedModelBuffer(ByteArray(0)) }
  }

  c.run("run decision: open only while active with a positive runId; a new runId restarts; inactive stops") {
    eq(0, WsfPoseContract.targetRun(false, 5))
    eq(0, WsfPoseContract.targetRun(true, 0))
    eq(0, WsfPoseContract.targetRun(true, -1))
    eq(5, WsfPoseContract.targetRun(true, 5))
    // (currentRunId, startedRunId, active, runId)
    eq(WsfRunChange(stop = false, start = 1), WsfPoseContract.runChange(0, 0, true, 1))
    eq(WsfRunChange(stop = false, start = 0), WsfPoseContract.runChange(1, 1, true, 1))
    eq(WsfRunChange(stop = true, start = 2), WsfPoseContract.runChange(1, 1, true, 2))
    eq(WsfRunChange(stop = true, start = 0), WsfPoseContract.runChange(1, 1, false, 1))
    eq(WsfRunChange(stop = false, start = 0), WsfPoseContract.runChange(0, 0, false, 0))
    eq(WsfRunChange(stop = false, start = 0), WsfPoseContract.runChange(0, 3, false, 7))
  }

  c.run("run decision: a run that stopped itself (error, detach) is never reopened under the same id") {
    // Native stopped run 4 (current 0) while the props still say active, runId 4.
    eq(WsfRunChange(stop = false, start = 0), WsfPoseContract.runChange(0, 4, true, 4))
    // A new id from JS opens a new run.
    eq(WsfRunChange(stop = false, start = 5), WsfPoseContract.runChange(0, 4, true, 5))
  }

  c.run("MEDIAPIPE_VERSION equals build.gradle mediapipeTasksVisionVersion") {
    val gradle = File(gradlePath).readText()
    val pinned = Regex("def mediapipeTasksVisionVersion = '([^']+)'").find(gradle)?.groupValues?.get(1)
    eq(pinned, WsfPoseContract.MEDIAPIPE_VERSION)
  }

  c.run("contract fixture: the recorded stream -> the onPose events Android would send") {
    val inputBytes = File(inputPath).readBytes()
    val input = JsonReader(String(inputBytes, Charsets.UTF_8)).parse() as Map<*, *>
    val frames = input["frames"] as List<*>
    val clock = WsfFrameClock()
    val dropped = ArrayList<Int>()
    val events = ArrayList<Map<String, Any>>()
    frames.forEachIndexed { index, raw ->
      val frame = raw as Map<*, *>
      val timestampNs = (frame["timestampNs"] as Number).toLong()
      // What WsfPoseRun.analyze does with one ImageProxy once MediaPipe has returned:
      if (clock.accept(timestampNs) == null) {
        dropped.add(index)
        return@forEachIndexed
      }
      val persons = (frame["persons"] as List<*>).map { landmarksOf(it as List<*>) }
      val people = WsfPoseContract.people(persons)
      val width = (frame["width"] as Number).toInt()
      val height = (frame["height"] as Number).toInt()
      events.add(WsfPoseContract.posePayload(timestampNs, width, height, people) + ("runId" to 1))
    }
    truth(events.isNotEmpty() && dropped.isNotEmpty(), "the stream exercises both paths")
    val out = StringBuilder()
    out.append("{\"generator\":\"WsfPoseContractTest.kt on the JVM: WsfFrameClock.accept + WsfPoseContract.people/posePayload + runId\",\n")
    out.append("\"inputSha256\":").append(json(WsfPoseContract.sha256Hex(inputBytes))).append(",\n")
    out.append("\"mediapipe\":").append(json(WsfPoseContract.MEDIAPIPE_VERSION)).append(",\n")
    out.append("\"dropped\":").append(json(dropped)).append(",\n")
    out.append("\"events\":[\n")
    events.forEachIndexed { i, e ->
      if (i > 0) out.append(",\n")
      out.append(json(e))
    }
    out.append("\n]}\n")
    File(outputPath).writeText(out.toString())
    println("     wrote ${events.size} events, dropped ${dropped.size} frames -> $outputPath")
  }

  c.finish()
}
