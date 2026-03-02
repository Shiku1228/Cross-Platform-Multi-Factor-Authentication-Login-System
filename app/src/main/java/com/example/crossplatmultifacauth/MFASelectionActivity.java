package com.example.crossplatmultifacauth;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;
import com.google.firebase.auth.ActionCodeSettings;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.auth.MultiFactorResolver;

public class MFASelectionActivity extends AppCompatActivity {

    public static MultiFactorResolver resolver;
    private TextView titleTextView, subtitleTextView;
    private LinearLayout optionsContainer;
    private MaterialCardView emailOptionCard, phoneOptionCard;
    private MaterialButton tryAnotherWayButton;
    private String userEmail;
    private FirebaseAuth mAuth;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_mfa_selection);

        mAuth = FirebaseAuth.getInstance();

        if (resolver == null) {
            finish();
            return;
        }

        titleTextView = findViewById(R.id.titleTextView);
        subtitleTextView = findViewById(R.id.subtitleTextView);
        optionsContainer = findViewById(R.id.optionsContainer);
        emailOptionCard = findViewById(R.id.emailOptionCard);
        phoneOptionCard = findViewById(R.id.phoneOptionCard);
        tryAnotherWayButton = findViewById(R.id.tryAnotherWayButton);

        userEmail = getSharedPreferences("PREFS", MODE_PRIVATE).getString("email", "");
        Log.d("MFASelectionActivity", "onCreate: userEmail=" + userEmail);

        // Check if this activity was opened from an email link first
        Intent intent = getIntent();
        Log.d("MFASelectionActivity", "onCreate: intent=" + (intent != null ? intent.toString() : "null"));
        if (intent != null && intent.getData() != null) {
            Log.d("MFASelectionActivity", "onCreate: intent.getData()=" + intent.getData().toString());
        }
        
        if (handleEmailLinkSignIn(intent)) {
            // If we handled an email link, don't send another email
            Log.d("MFASelectionActivity", "onCreate: Email link handled, returning early");
            return;
        }

        // Only send email if not coming from a link and email is available
        if (!userEmail.isEmpty()) {
            Log.d("MFASelectionActivity", "onCreate: Sending Gmail sign-in link");
            sendGmailSignInLink();
        }

        tryAnotherWayButton.setOnClickListener(v -> {
            titleTextView.setText("Verify it's you");
            subtitleTextView.setText("Choose how you want to verify your identity.");
            optionsContainer.setVisibility(View.VISIBLE);
            tryAnotherWayButton.setVisibility(View.GONE);
        });

        phoneOptionCard.setOnClickListener(v -> {
            MFAActivity.resolver = resolver;
            startActivity(new Intent(this, MFAActivity.class));
        });

        emailOptionCard.setOnClickListener(v -> {
            // Open Gmail OTP code entry interface
            GmailOTPActivity.resolver = resolver;
            startActivity(new Intent(this, GmailOTPActivity.class));
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Fail-safe: Check if the user is already verified every time they return to the app
        checkVerificationStatus();
    }

    private void checkVerificationStatus() {
        FirebaseUser user = mAuth.getCurrentUser();
        if (user != null) {
            user.reload().addOnCompleteListener(task -> {
                if (user.isEmailVerified()) {
                    Toast.makeText(this, "Verified! Opening Dashboard...", Toast.LENGTH_SHORT).show();
                    startActivity(new Intent(this, MainActivity.class));
                    finish();
                }
            });
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleEmailLinkSignIn(intent);
    }

    private boolean handleEmailLinkSignIn(Intent intent) {
        if (intent == null || intent.getData() == null) return false;
        
        String emailLink = intent.getData().toString();
        Log.d("MFASelectionActivity", "Checking email link: " + emailLink);
        
        if (mAuth.isSignInWithEmailLink(emailLink)) {
            Log.d("MFASelectionActivity", "Valid email link detected, signing in...");
            mAuth.signInWithEmailLink(userEmail, emailLink).addOnCompleteListener(task -> {
                if (task.isSuccessful()) {
                    Log.d("MFASelectionActivity", "Sign-in successful, going to dashboard");
                    startActivity(new Intent(this, MainActivity.class));
                    finish();
                } else {
                    String errorMessage = task.getException() != null ? task.getException().getMessage() : "Unknown error";
                    Log.e("MFASelectionActivity", "Verification failed: " + errorMessage);
                    Toast.makeText(this, "Verification failed: " + errorMessage, Toast.LENGTH_LONG).show();
                }
            });
            return true;
        }
        return false;
    }

    private void sendGmailSignInLink() {
        String url = "https://multi-factor-authenticat-8e8bc.firebaseapp.com/login";
        Log.d("MFASelectionActivity", "Attempting to send verification link to: " + userEmail);

        ActionCodeSettings actionCodeSettings = ActionCodeSettings.newBuilder()
                .setUrl(url)
                .setHandleCodeInApp(true)
                .setAndroidPackageName("com.example.crossplatmultifacauth", true, null)
                .build();

        Log.d("MFASelectionActivity", "ActionCodeSettings configured: " + actionCodeSettings.getUrl());

        mAuth.sendSignInLinkToEmail(userEmail, actionCodeSettings)
                .addOnCompleteListener(task -> {
                    if (task.isSuccessful()) {
                        Log.d("MFASelectionActivity", "Verification link sent successfully to: " + userEmail);
                        Toast.makeText(this, "Verification link sent to Gmail! Check your inbox.", Toast.LENGTH_LONG).show();
                    } else {
                        String errorMessage = task.getException() != null ? task.getException().getMessage() : "Unknown error";
                        Log.e("MFASelectionActivity", "Failed to send verification link: " + errorMessage);
                        Toast.makeText(this, "Error sending email: " + errorMessage, Toast.LENGTH_LONG).show();
                    }
                });
    }
}
