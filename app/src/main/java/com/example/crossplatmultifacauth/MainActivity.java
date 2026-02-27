package com.example.crossplatmultifacauth;

import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.EdgeToEdge;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.auth.MultiFactorSession;
import com.google.firebase.auth.PhoneAuthCredential;
import com.google.firebase.auth.PhoneAuthOptions;
import com.google.firebase.auth.PhoneAuthProvider;
import com.google.firebase.auth.PhoneMultiFactorGenerator;

import java.util.concurrent.TimeUnit;

public class MainActivity extends AppCompatActivity {

    private Button logoutButton, enrollMfaButton;
    private TextView userEmailTextView;
    private FirebaseAuth mAuth;
    private String verificationId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
        setContentView(R.layout.activity_main);

        mAuth = FirebaseAuth.getInstance();
        
        userEmailTextView = findViewById(R.id.userEmailTextView);
        logoutButton = findViewById(R.id.logoutButton);
        enrollMfaButton = findViewById(R.id.enrollMfaButton);

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.main), (v, insets) -> {
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
            return insets;
        });

        logoutButton.setOnClickListener(v -> {
            mAuth.signOut();
            Intent intent = new Intent(MainActivity.this, LoginActivity.class);
            startActivity(intent);
            finish();
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        checkUserStatus(); // Refresh status every time the user returns to the app
    }

    private void checkUserStatus() {
        FirebaseUser user = mAuth.getCurrentUser();
        if (user == null) {
            startActivity(new Intent(this, LoginActivity.class));
            finish();
            return;
        }

        // Reload the user to get the latest email verification status
        user.reload().addOnCompleteListener(task -> {
            FirebaseUser updatedUser = mAuth.getCurrentUser();
            userEmailTextView.setText("Logged in as: " + updatedUser.getEmail());

            if (!updatedUser.isEmailVerified()) {
                enrollMfaButton.setText("Verify Email to Enable MFA");
                enrollMfaButton.setOnClickListener(v -> {
                    updatedUser.sendEmailVerification().addOnCompleteListener(emailTask -> {
                        if (emailTask.isSuccessful()) {
                            Toast.makeText(this, "Verification email sent! Check your inbox.", Toast.LENGTH_SHORT).show();
                        }
                    });
                });
            } else {
                enrollMfaButton.setText("Enable Multi-Factor Auth (MFA)");
                enrollMfaButton.setOnClickListener(v -> showPhoneInputDialog());
            }
        });
    }

    private void showPhoneInputDialog() {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Enroll MFA");
        builder.setMessage("Enter phone number (Use your Firebase Test Number if on Free Plan)");
        
        final EditText input = new EditText(this);
        input.setHint("+639123456789");
        input.setPadding(50, 40, 50, 40);
        builder.setView(input);

        builder.setPositiveButton("Send Code", (dialog, which) -> {
            String phoneNumber = input.getText().toString().trim();
            if (!phoneNumber.isEmpty()) {
                startMfaEnrollment(phoneNumber);
            }
        });
        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());
        builder.show();
    }

    private void startMfaEnrollment(String phoneNumber) {
        FirebaseUser user = mAuth.getCurrentUser();
        if (user != null) {
            user.getMultiFactor().getSession().addOnCompleteListener(task -> {
                if (task.isSuccessful()) {
                    MultiFactorSession session = task.getResult();
                    PhoneAuthOptions options = PhoneAuthOptions.newBuilder()
                            .setPhoneNumber(phoneNumber)
                            .setMultiFactorSession(session)
                            .setActivity(this)
                            .setTimeout(30L, TimeUnit.SECONDS)
                            .setCallbacks(new PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
                                @Override
                                public void onVerificationCompleted(@NonNull PhoneAuthCredential credential) {}

                                @Override
                                public void onVerificationFailed(@NonNull com.google.firebase.FirebaseException e) {
                                    Toast.makeText(MainActivity.this, "Error: " + e.getMessage(), Toast.LENGTH_LONG).show();
                                }

                                @Override
                                public void onCodeSent(@NonNull String vId, @NonNull PhoneAuthProvider.ForceResendingToken token) {
                                    verificationId = vId;
                                    showCodeInputDialog();
                                }
                            })
                            .build();
                    PhoneAuthProvider.verifyPhoneNumber(options);
                }
            });
        }
    }

    private void showCodeInputDialog() {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Enter 6-Digit Code");
        final EditText input = new EditText(this);
        input.setHint("123456");
        input.setPadding(50, 40, 50, 40);
        builder.setView(input);

        builder.setPositiveButton("Verify", (dialog, which) -> {
            String code = input.getText().toString().trim();
            finalizeEnrollment(code);
        });
        builder.show();
    }

    private void finalizeEnrollment(String code) {
        FirebaseUser user = mAuth.getCurrentUser();
        if (user != null) {
            PhoneAuthCredential credential = PhoneAuthProvider.getCredential(verificationId, code);
            user.getMultiFactor().enroll(PhoneMultiFactorGenerator.getAssertion(credential), "My Phone")
                    .addOnCompleteListener(task -> {
                        if (task.isSuccessful()) {
                            Toast.makeText(this, "MFA Enabled! Logout and login again to see the challenge.", Toast.LENGTH_LONG).show();
                        } else {
                            String error = task.getException() != null ? task.getException().getMessage() : "Unknown error";
                            Toast.makeText(this, "Enrollment Failed: " + error, Toast.LENGTH_LONG).show();
                        }
                    });
        }
    }
}