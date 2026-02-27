package com.example.crossplatmultifacauth;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;
import com.google.firebase.auth.ActionCodeSettings;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.MultiFactorInfo;
import com.google.firebase.auth.MultiFactorResolver;
import com.google.firebase.auth.PhoneMultiFactorInfo;
import com.google.firebase.firestore.FirebaseFirestore;
import java.util.Random;

public class MFASelectionActivity extends AppCompatActivity {

    public static MultiFactorResolver resolver;
    private TextView titleTextView, subtitleTextView;
    private LinearLayout optionsContainer;
    private MaterialCardView emailOptionCard, phoneOptionCard;
    private MaterialButton tryAnotherWayButton;
    private String userEmail;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_mfa_selection);

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

        // Get user email
        userEmail = getSharedPreferences("PREFS", MODE_PRIVATE).getString("email", "");

        if (!userEmail.isEmpty()) {
            sendGmailSignInLink();
        } else {
            Toast.makeText(this, "Error: Email not found", Toast.LENGTH_SHORT).show();
        }

        tryAnotherWayButton.setOnClickListener(v -> {
            titleTextView.setText("Verify it's you");
            subtitleTextView.setText("Choose how you want to verify your identity.");
            optionsContainer.setVisibility(View.VISIBLE);
            tryAnotherWayButton.setVisibility(View.GONE);
        });

        emailOptionCard.setOnClickListener(v -> sendEmailOTP());
        
        phoneOptionCard.setOnClickListener(v -> {
            MFAActivity.resolver = resolver;
            startActivity(new Intent(this, MFAActivity.class));
        });
    }

    private void sendGmailSignInLink() {
        // Use your Firebase Project's default domain
        String url = "https://multi-factor-authenticat-8e8bc.firebaseapp.com";

        ActionCodeSettings actionCodeSettings = ActionCodeSettings.newBuilder()
                .setUrl(url)
                .setHandleCodeInApp(true)
                .setAndroidPackageName("com.example.crossplatmultifacauth", true, "1")
                .build();

        FirebaseAuth.getInstance().sendSignInLinkToEmail(userEmail, actionCodeSettings)
                .addOnCompleteListener(task -> {
                    if (task.isSuccessful()) {
                        Toast.makeText(this, "Sign-in link sent to " + userEmail, Toast.LENGTH_LONG).show();
                    } else {
                        String error = task.getException() != null ? task.getException().getMessage() : "Unknown error";
                        Toast.makeText(this, "Email Failed: " + error, Toast.LENGTH_LONG).show();
                    }
                });
    }

    private void sendEmailOTP() {
        String otp = String.valueOf(100000 + new Random().nextInt(900000));
        Toast.makeText(this, "OTP Code: " + otp + " (Sent to Gmail)", Toast.LENGTH_LONG).show();
    }
}