// Cogwait JetBrains plugin — builds with `gradle buildPlugin` (pulls the IntelliJ
// Platform SDK). Renders the labeled sponsor line in the IDE status bar via the
// official StatusBarWidget API. No IDE injection; the user installs the plugin.
plugins {
  id("org.jetbrains.intellij") version "1.17.4"
  java
}

group = "io.cogwait"
version = "0.1.0"

repositories { mavenCentral() }

intellij {
  version.set("2023.3")
  type.set("IC") // IntelliJ IDEA Community — the widget API is platform-wide
}

java {
  sourceCompatibility = JavaVersion.VERSION_17
  targetCompatibility = JavaVersion.VERSION_17
}

tasks {
  patchPluginXml {
    sinceBuild.set("233")
    untilBuild.set("")
  }
}
