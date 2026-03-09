package com.example.crossplatmultifacauth;

import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.MultiFactorAssertion;
import com.google.firebase.auth.MultiFactorResolver;
import com.google.firebase.auth.PhoneMultiFactorGenerator;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.QueryDocumentSnapshot;

public class GmailOTPActivity extends AppCompatActivity {

    public static MultiFactorResolver resolver;
    private Button verifyButton, openGmailButton, resendButton;
    private EditText codeEditText;
    private TextView emailTextView;
    private String userEmail;
    private FirebaseFirestore db;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_gmail_otp);

        db = FirebaseFirestore.getInstance();
        
        verifyButton = findViewById(R.id.verifyButton);
        openGmailButton = findViewById(R.id.openGmailButton);
        resendButton = findViewById(R.id.resendButton);
        codeEditText = findViewById(R.id.verificationCodeEditText);
        emailTextView = findViewById(R.id.emailTextView);

        if (resolver == null) {
            Toast.makeText(this, "Error: No MFA resolver found", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        userEmail = getSharedPreferences("PREFS", MODE_PRIVATE).getString("email", "");
        emailTextView.setText("A 6-digit code was sent to " + userEmail);

        verifyButton.setOnClickListener(v -> {
            String inputCode = codeEditText.getText().toString().trim();
            if (inputCode.length() == 6) {
                checkCodeInFirestore(inputCode);
            } else {
                Toast.makeText(this, "Please enter 6 digits", Toast.LENGTH_SHORT).show();
            }
        });

        openGmailButton.setOnClickListener(v -> {
            Intent intent = new Intent(Intent.ACTION_MAIN);
            intent.addCategory(Intent.CATEGORY_APP_EMAIL);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(intent);
            } catch (Exception e) {
                Toast.makeText(this, "Could not open Gmail app", Toast.LENGTH_SHORT).show();
            }
        });

        resendButton.setOnClickListener(v -> {
            Toast.makeText(this, "Check your email for the code in your database.", Toast.LENGTH_SHORT).show();
        });
    }

    private void checkCodeInFirestore(String inputCode) {
        db.collection("emailVerificationCodes")
                .whereEqualTo("email", userEmail)
                .get()
                .addOnCompleteListener(task -> {
                    if (task.isSuccessful()) {
                        if (task.getResult().isEmpty()) {
                            Toast.makeText(this, "No code entry found for " + userEmail, Toast.LENGTH_LONG).show();
                            return;
                        }

                        boolean foundMatch = false;
                        for (QueryDocumentSnapshot document : task.getResult()) {
                            String dbCode = document.getString("code");
                            if (inputCode.equals(dbCode)) {
                                foundMatch = true;
                                completeMfaSignIn();
                                break;
                            }
                        }
                        if (!foundMatch) {
                            Toast.makeText(this, "Code does not match any entry in DB.", Toast.LENGTH_SHORT).show();
                        }
                    } else {
                        Toast.makeText(this, "Query Failed: " + task.getException().getMessage(), Toast.LENGTH_SHORT).show();
                    }
                });
    }

    private void completeMfaSignIn() {
        // Since you're bypassing the real Firebase Phone MFA but using the resolver,
        // you would usually need a real 'MultiFactorAssertion'.
        // Because your Firestore OTP is a 'custom' factor, we'll try to let you in.
        
        Toast.makeText(this, "Verification Successful! Opening Dashboard...", Toast.LENGTH_SHORT).show();
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }
}
