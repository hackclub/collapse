function checkHash() {
    if (window.location.hash.startsWith("#/tray")) {
        return "Tray";
    }
    return "App";
}
