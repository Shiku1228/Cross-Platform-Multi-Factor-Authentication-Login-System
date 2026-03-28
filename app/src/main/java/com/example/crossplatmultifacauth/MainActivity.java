package com.example.crossplatmultifacauth;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
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
import com.google.firebase.auth.FirebaseAuthMultiFactorException;
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
            getSharedPreferences("PREFS", MODE_PRIVATE).edit()
                .remove("email")
                .remove("password")
                .remove("mfa_completed")
                .remove("manual_session_active")
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
        checkUserStatus(); 
    }

    private void checkUserStatus() {
        FirebaseUser user = mAuth.getCurrentUser();
        boolean mfaCompletedViaGmail = getSharedPreferences("PREFS", MODE_PRIVATE).getBoolean("mfa_completed", false);
        boolean manualSessionActive = getSharedPreferences("PREFS", MODE_PRIVATE).getBoolean("manual_session_active", false);
        String storedEmail = getSharedPreferences("PREFS", MODE_PRIVATE).getString("email", "");
        String storedPassword = getSharedPreferences("PREFS", MODE_PRIVATE).getString("password", "");

        Log.d("MainActivity", "checkUserStatus: user=" + (user != null ? "Logged In" : "Null") + 
              ", GmailVerified=" + mfaCompletedViaGmail + ", ManualSession=" + manualSessionActive);

        // Kung may active manual session na tayo, ipakita lang ang UI at huwag nang mag-re-auth
        if (manualSessionActive) {
            userEmailTextView.setText("Account: " + storedEmail);
            enrollMfaButton.setText("MFA is Active ✅");
            enrollMfaButton.setEnabled(false);
            return;
        }

        // Case: Kailangan mag-silent re-auth (galing Gmail OTP o nawalan ng session)
        if (mfaCompletedViaGmail || (user == null && !storedEmail.isEmpty() && !storedPassword.isEmpty())) {
            userEmailTextView.setText("Account: " + storedEmail);
            enrollMfaButton.setText("Verifying session...");
            enrollMfaButton.setEnabled(false);

            mAuth.signInWithEmailAndPassword(storedEmail, storedPassword)
                .addOnCompleteListener(this, task -> {
                    if (task.isSuccessful()) {
                        Log.d("MainActivity", "Silent re-auth successful (No MFA on account)");
                        getSharedPreferences("PREFS", MODE_PRIVATE).edit()
                            .remove("mfa_completed")
                            .apply();
                        updateUIWithUser(mAuth.getCurrentUser());
                    } else if (task.getException() instanceof FirebaseAuthMultiFactorException) {
                        Log.d("MainActivity", "Silent re-auth: MFA detected. This confirms MFA is ACTIVE.");
                        // HETO ANG FIX: Dahil may MFA exception, ibig sabihin Active ang MFA.
                        // At dahil galing na sa Gmail OTP, ituturing nating valid ang session.
                        getSharedPreferences("PREFS", MODE_PRIVATE).edit()
                            .remove("mfa_completed")
                            .putBoolean("manual_session_active", true)
                            .apply();
                        
                        userEmailTextView.setText("Account: " + storedEmail);
                        enrollMfaButton.setText("MFA is Active ✅");
                        enrollMfaButton.setEnabled(false);
                    } else {
                        Log.e("MainActivity", "Silent re-auth failed: " + task.getException().getMessage());
                        redirectToLogin();
                    }
                });
            return;
        }

        if (user == null) {
            redirectToLogin();
            return;
        }

        updateUIWithUser(user);
    }

    private void updateUIWithUser(FirebaseUser user) {
        if (user == null) return;

        user.reload().addOnCompleteListener(task -> {
            FirebaseUser updatedUser = mAuth.getCurrentUser();
            if (updatedUser == null) {
                redirectToLogin();
                return;
            }

            userEmailTextView.setText("Account: " + updatedUser.getEmail());
            enrollMfaButton.setEnabled(true);

            if (!updatedUser.isEmailVerified()) {
                enrollMfaButton.setText("1. Verify Email (Required)");
                enrollMfaButton.setOnClickListener(v -> {
                    updatedUser.sendEmailVerification().addOnCompleteListener(emailTask -> {
                        if (emailTask.isSuccessful()) {
                            showStatusDialog("Verification Sent", "Check your inbox and click the link. Then return here.");
                        }
                    });
                });
            } else {
                if (!updatedUser.getMultiFactor().getEnrolledFactors().isEmpty()) {
                    enrollMfaButton.setText("MFA is Active ✅");
                    enrollMfaButton.setEnabled(false);
                    // I-save na rin dito para sa future resumes
                    getSharedPreferences("PREFS", MODE_PRIVATE).edit().putBoolean("manual_session_active", true).apply();
                } else {
                    enrollMfaButton.setText("2. Enable MFA (SMS)");
                    enrollMfaButton.setOnClickListener(v -> showPhoneInputDialog());
                }
            }
        });
    }
    
    private void redirectToLogin() {
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
