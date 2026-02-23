plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
}

android {
    namespace = "com.example.crossplatmultifacauth"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.example.crossplatmultifacauth"
        minSdk = 34
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

dependencies {
    implementation(libs.appcompat)
    implementation(libs.material)
    implementation(libs.activity)
    implementation(libs.constraintlayout)

    //firebase dependencies=======================================================
    //Firebase BOM (manage the version of the firebase)
    implementation(platform("com.google.firebase:firebase-bom:33.9.0"))

    //Firebase Authentication (for the log in implementation)
    implementation("com.google.firebase:firebase-auth")

    //Google Sign In
    implementation("com.google.android.gms:play-services-auth:21.3.0")

    //Firebase Firestore
    implementation("com.google.firebase:firebase-firestore")

    implementation("com.google.firebase:firebase-analytics")

    testImplementation(libs.junit)
    androidTestImplementation(libs.ext.junit)
    androidTestImplementation(libs.espresso.core)
}