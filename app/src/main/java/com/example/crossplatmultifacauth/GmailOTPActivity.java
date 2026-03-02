package com.example.crossplatmultifacauth;

import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.auth.ActionCodeSettings;
import com.google.firebase.auth.AuthResult;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.MultiFactorAssertion;
import com.google.firebase.auth.MultiFactorResolver;
import com.google.firebase.auth.MultiFactorSession;
import com.google.firebase.auth.EmailAuthProvider;

public class GmailOTPActivity extends AppCompatActivity {

    public static MultiFactorResolver resolver;
    private EditText verificationCodeEditText;
    private Button verifyButton, resendButton;
    private TextView emailTextView;
    private String userEmail;
    private FirebaseAuth mAuth;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_gmail_otp);

        mAuth = FirebaseAuth.getInstance();
        
        verificationCodeEditText = findViewById(R.id.verificationCodeEditText);
        verifyButton = findViewById(R.id.verifyButton);
        resendButton = findViewById(R.id.resendButton);
        emailTextView = findViewById(R.id.emailTextView);

        if (resolver == null) {
            Toast.makeText(this, "Error: No MFA resolver found", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        userEmail = getSharedPreferences("PREFS", MODE_PRIVATE).getString("email", "");
        emailTextView.setText("Code sent to " + maskEmail(userEmail));

        // Send initial OTP
        sendGmailOTP();

        verifyButton.setOnClickListener(v -> {
            String code = verificationCodeEditText.getText().toString().trim();
            if (code.isEmpty()) {
                Toast.makeText(GmailOTPActivity.this, "Enter code", Toast.LENGTH_SHORT).show();
                return;
            }
            verifyCode(code);
        });

        resendButton.setOnClickListener(v -> {
            sendGmailOTP();
            Toast.makeText(this, "Code resent to " + maskEmail(userEmail), Toast.LENGTH_SHORT).show();
        });
    }

    private String maskEmail(String email) {
        if (email == null || email.isEmpty()) return "";
        int atIndex = email.indexOf("@");
        if (atIndex <= 2) return email;
        String masked = email.substring(0, 2) + "*".repeat(atIndex - 2) + email.substring(atIndex);
        return masked;
    }

    private void sendGmailOTP() {
        // For email OTP, we'll use the email link authentication as OTP
        String url = "https://multi-factor-authenticat-8e8bc.firebaseapp.com/login";
        
        ActionCodeSettings actionCodeSettings = ActionCodeSettings.newBuilder()
                .setUrl(url)
                .setHandleCodeInApp(true)
                .setAndroidPackageName("com.example.crossplatmultifacauth", true, null)
                .build();

        mAuth.sendSignInLinkToEmail(userEmail, actionCodeSettings)
                .addOnCompleteListener(task -> {
                    if (task.isSuccessful()) {
                        Toast.makeText(this, "Verification code sent to Gmail!", Toast.LENGTH_SHORT).show();
                    } else {
                        String errorMessage = task.getException() != null ? task.getException().getMessage() : "Unknown error";
                        Toast.makeText(this, "Failed to send code: " + errorMessage, Toast.LENGTH_LONG).show();
                    }
                });
    }

    private void verifyCode(String code) {
        // Since Firebase doesn't support email OTP codes directly,
        // we'll use the email link verification approach
        // The code here is just for UI consistency - actual verification happens via email link
        
        Toast.makeText(this, "Please check your Gmail and click the verification link to complete sign-in", Toast.LENGTH_LONG).show();
        
        // You could also implement a custom OTP system here where:
        // 1. Generate a 6-digit code
        // 2. Send it via email service (SendGrid, etc.)
        // 3. Verify the entered code matches what you sent
        // 4. Complete the MFA resolution
        
        // For now, we'll redirect to the original email link flow
        finish();
    }
}
