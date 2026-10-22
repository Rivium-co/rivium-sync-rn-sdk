# Third-Party Notices

The React Native package has no third-party JavaScript dependencies (React and
React Native are peer dependencies). It runs on Rivium's native Sync SDKs,
which use the following third-party components.
None of them is vendored: Gradle, CocoaPods or Swift Package Manager pulls
them into your build. See each upstream repository for the full license text.

---

## Android (`co.rivium:rivium-sync-android`)

| Component | Version | Used for | License |
|---|---|---|---|
| [Eclipse Paho MQTT client](https://github.com/eclipse/paho.mqtt.java) (via `co.rivium:pn-protocol`) | 1.2.5 | Realtime connection | Eclipse Public License 2.0 / Eclipse Distribution License 1.0 (dual) |
| [OkHttp](https://github.com/square/okhttp) | 4.12.0 | HTTP client | Apache License 2.0 |
| [Gson](https://github.com/google/gson) | 2.10.1 | JSON | Apache License 2.0 |
| [Kotlin coroutines](https://github.com/Kotlin/kotlinx.coroutines) | 1.7.3 | | Apache License 2.0 |
| [AndroidX Core and Room](https://developer.android.com/jetpack/androidx) | core-ktx 1.12.0, Room 2.6.1 | Offline cache and pending writes | Apache License 2.0 |

---

## iOS (`RiviumSync` pod)

| Component | Version | Used for | License |
|---|---|---|---|
| [CocoaMQTT](https://github.com/emqx/CocoaMQTT) (via `PNProtocol`) | 2.x | Realtime connection | Eclipse Public License 1.0 / Eclipse Distribution License 1.0 (dual) |
| [MqttCocoaAsyncSocket](https://github.com/leeway1208/MqttCocoaAsyncSocket) (via CocoaMQTT) | 1.0.8 | TCP and TLS sockets | Public Domain, or BSD License (Copyright (c) 2017, Deusty, LLC), at your choice |
