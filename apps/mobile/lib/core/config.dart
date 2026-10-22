/// API base URL, set at build time:
///   flutter run --dart-define=API_URL=http://192.168.1.20:4000
/// On the Android emulator the host machine is 10.0.2.2; on a real phone use the laptop's LAN IP.
const apiBaseUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:4000');
