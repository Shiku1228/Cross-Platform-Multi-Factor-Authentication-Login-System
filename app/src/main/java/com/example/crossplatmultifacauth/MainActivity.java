package com.example.crossplatmultifacauth;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.EdgeToEdge;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;
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
    private boolean mfaJustCompleted = false; // Flag to prevent immediate re-auth

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
            // Clear stored credentials for security
            getSharedPreferences("PREFS", MODE_PRIVATE).edit()
                .remove("email")
                .remove("password")
                .apply();
            Intent intent = new Intent(MainActivity.this, LoginActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            startActivity(intent);
            finish();
        });

        checkUserStatus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        Log.d("MainActivity", "onResume called");
        checkUserStatus(); 
    }

    private void checkUserStatus() {
        FirebaseUser user = mAuth.getCurrentUser();
        
        Log.d("MainActivity", "checkUserStatus: Current user is " + (user != null ? user.getEmail() : "null"));
        
        // Check if MFA was just completed through Gmail OTP
        boolean mfaCompleted = getSharedPreferences("PREFS", MODE_PRIVATE).getBoolean("mfa_completed", false);
        Log.d("MainActivity", "checkUserStatus: MFA completed flag: " + mfaCompleted);
        
        // If MFA was just completed, clear flag and allow user to stay in MainActivity
        if (mfaCompleted) {
            Log.d("MainActivity", "MFA was just completed, clearing flag and allowing access");
            getSharedPreferences("PREFS", MODE_PRIVATE).edit()
                .remove("mfa_completed")
                .apply();
            
            // Set our internal flag to prevent immediate re-authentication
            mfaJustCompleted = true;
            
            // Show email from stored preferences and allow access regardless of Firebase user state
            String storedEmail = getSharedPreferences("PREFS", MODE_PRIVATE).getString("email", "");
            userEmailTextView.setText("Account: " + storedEmail);
            Log.d("MainActivity", "MFA completed - allowing access with email: " + storedEmail);
            return; // CRITICAL: Return here to skip all other checks
        }
        
        // If we just came from a successful custom verification, user might be 
        // null in the standard mAuth but the session is actually valid.
        if (user == null) {
            // If MFA was just completed, don't try to re-authenticate
            if (mfaJustCompleted) {
                Log.d("MainActivity", "MFA just completed, skipping re-authentication");
                // Reset the flag after a short delay to allow normal operation
                mfaJustCompleted = false;
                return;
            }
            
            // Try to check if we have stored credentials that might indicate a recent successful MFA
            String storedEmail = getSharedPreferences("PREFS", MODE_PRIVATE).getString("email", "");
            String storedPassword = getSharedPreferences("PREFS", MODE_PRIVATE).getString("password", "");
            
            Log.d("MainActivity", "checkUserStatus: No current user. Stored credentials available: " + 
                  (!storedEmail.isEmpty() && !storedPassword.isEmpty()));
            
            // If we have stored credentials, try to re-authenticate
            if (!storedEmail.isEmpty() && !storedPassword.isEmpty()) {
                Log.d("MainActivity", "Attempting to re-authenticate with stored credentials");
                mAuth.signInWithEmailAndPassword(storedEmail, storedPassword)
                        .addOnCompleteListener(this, task -> {
                            if (task.isSuccessful()) {
                                Log.d("MainActivity", "Re-authentication successful");
                                // Reload the user status
                                checkUserStatus();
                            } else {
                                Log.e("MainActivity", "Re-authentication failed: " + task.getException().getMessage());
                                // If re-auth fails, redirect to login
                                redirectToLogin();
                            }
                        });
                return;
            } else {
                // No stored credentials, redirect to login
                redirectToLogin();
                return;
            }
        }

        user.reload().addOnCompleteListener(task -> {
            FirebaseUser updatedUser = mAuth.getCurrentUser();
            if (updatedUser == null) {
                Log.e("MainActivity", "User became null after reload");
                redirectToLogin();
                return;
            }

            Log.d("MainActivity", "User reload successful: " + updatedUser.getEmail());
            userEmailTextView.setText("Account: " + updatedUser.getEmail());

            if (!updatedUser.isEmailVerified()) {
                Log.d("MainActivity", "Email not verified, showing verification button");
                enrollMfaButton.setText("1. Verify Email (Required)");
                enrollMfaButton.setAlpha(0.8f);
                enrollMfaButton.setOnClickListener(v -> {
                    updatedUser.sendEmailVerification().addOnCompleteListener(emailTask -> {
                        if (emailTask.isSuccessful()) {
                            showStatusDialog("Verification Sent", "Check your inbox and click the link. Then return here.");
                        } else {
                            Toast.makeText(this, "Error: " + emailTask.getException().getMessage(), Toast.LENGTH_SHORT).show();
                        }
                    });
                });
            } else {
                Log.d("MainActivity", "Email verified, checking MFA status");
                enrollMfaButton.setText("2. Enable MFA (SMS)");
                enrollMfaButton.setAlpha(1.0f);
                enrollMfaButton.setOnClickListener(v -> showPhoneInputDialog());
                
                if (!updatedUser.getMultiFactor().getEnrolledFactors().isEmpty()) {
                    Log.d("MainActivity", "MFA is already enrolled");
                    enrollMfaButton.setText("MFA is Active ✅");
                    enrollMfaButton.setEnabled(false);
                }
            }
        });
    }
    
    private void redirectToLogin() {
        Log.d("MainActivity", "Redirecting to login");
        startActivity(new Intent(this, LoginActivity.class));
        finish();
    }

    private void showStatusDialog(String title, String message) {
        new MaterialAlertDialogBuilder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton("OK", null)
                .show();
    }

    private void showPhoneInputDialog() {
        final EditText input = new EditText(this);
        input.setHint("+639123456789");
        int padding = (int) (20 * getResources().getDisplayMetrics().density);
        input.setPadding(padding, padding, padding, padding);

        new MaterialAlertDialogBuilder(this)
                .setTitle("Step 2: Enroll Phone")
                .setMessage("Enter your mobile number to receive security codes.")
                .setView(input)
                .setPositiveButton("Send SMS Code", (dialog, which) -> {
                    String phoneNumber = input.getText().toString().trim();
                    if (!phoneNumber.isEmpty()) {
                        startMfaEnrollment(phoneNumber);
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void startMfaEnrollment(String phoneNumber) {
        FirebaseUser user = mAuth.getCurrentUser();
        if (user == null) return;

        user.getMultiFactor().getSession().addOnCompleteListener(task -> {
            if (task.isSuccessful()) {
                MultiFactorSession session = task.getResult();
                PhoneAuthOptions options = PhoneAuthOptions.newBuilder()
                        .setPhoneNumber(phoneNumber)
                        .setMultiFactorSession(session)
                        .setActivity(this)
                        .setTimeout(60L, TimeUnit.SECONDS)
                        .setCallbacks(new PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
                            @Override
                            public void onVerificationCompleted(@NonNull PhoneAuthCredential credential) {}

                            @Override
                            public void onVerificationFailed(@NonNull com.google.firebase.FirebaseException e) {
                                showStatusDialog("SMS Failed", e.getMessage());
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

    private void showCodeInputDialog() {
        final EditText input = new EditText(this);
        input.setHint("123456");
        int padding = (int) (20 * getResources().getDisplayMetrics().density);
        input.setPadding(padding, padding, padding, padding);

        new MaterialAlertDialogBuilder(this)
                .setTitle("Verify SMS Code")
                .setMessage("Enter the 6-digit code sent to your phone.")
                .setView(input)
                .setPositiveButton("Verify & Enable", (dialog, which) -> {
                    String code = input.getText().toString().trim();
                    finalizeEnrollment(code);
                })
                .setCancelable(false)
                .show();
    }

    private void finalizeEnrollment(String code) {
        FirebaseUser user = mAuth.getCurrentUser();
        if (user == null) return;

        PhoneAuthCredential credential = PhoneAuthProvider.getCredential(verificationId, code);
        user.getMultiFactor().enroll(PhoneMultiFactorGenerator.getAssertion(credential), "Primary Phone")
                .addOnCompleteListener(task -> {
                    if (task.isSuccessful()) {
                        new MaterialAlertDialogBuilder(this)
                                .setTitle("MFA Enabled!")
                                .setMessage("Your account is now protected. Logout and login again to test.")
                                .setPositiveButton("Logout", (d, w) -> logoutButton.performClick())
                                .show();
                    } else {
                        showStatusDialog("Enrollment Failed", task.getException().getMessage());
                    }
                });
    }
}
