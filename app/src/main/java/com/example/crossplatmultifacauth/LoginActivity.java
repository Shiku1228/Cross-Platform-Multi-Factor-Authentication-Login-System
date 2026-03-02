package com.example.crossplatmultifacauth;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.material.button.MaterialButton;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;
import com.google.firebase.auth.ActionCodeSettings;
import com.google.firebase.auth.AuthCredential;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthMultiFactorException;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.auth.GoogleAuthProvider;
import com.google.firebase.auth.MultiFactorResolver;

public class LoginActivity extends AppCompatActivity {

    private static final int RC_SIGN_IN = 9001;
    private EditText emailEditText;
    private EditText passwordEditText;
    private MaterialButton signInButton, emailLinkButton, googleSignInButton;
    private TextView signUpTextView;
    private FirebaseAuth mAuth;
    private GoogleSignInClient mGoogleSignInClient;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login);

        mAuth = FirebaseAuth.getInstance();

        // Check if the activity was opened from an Email Link
        handleEmailLinkSignIn(getIntent());

        GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestIdToken(getString(R.string.default_web_client_id))
                .requestEmail()
                .build();

        mGoogleSignInClient = GoogleSignIn.getClient(this, gso);

        emailEditText = findViewById(R.id.emailEditText);
        passwordEditText = findViewById(R.id.passwordEditText);
        signInButton = findViewById(R.id.signInButton);
        emailLinkButton = findViewById(R.id.emailLinkButton);
        googleSignInButton = findViewById(R.id.googleSignInButton);
        signUpTextView = findViewById(R.id.signUpTextView);

        signInButton.setOnClickListener(v -> {
            String email = emailEditText.getText().toString().trim();
            String password = passwordEditText.getText().toString().trim();

            if (email.isEmpty() || password.isEmpty()) {
                Toast.makeText(this, "Please enter email and password", Toast.LENGTH_SHORT).show();
                return;
            }

            // Save email to SharedPreferences so MFASelectionActivity can find it
            getSharedPreferences("PREFS", MODE_PRIVATE).edit().putString("email", email).apply();

            mAuth.signInWithEmailAndPassword(email, password)
                .addOnCompleteListener(this, task -> {
                    if (task.isSuccessful()) {
                        goToDashboard();
                    } else {
                        handleSignInError(task.getException());
                    }
                });
        });

        // OTP to Gmail Logic
        emailLinkButton.setOnClickListener(v -> {
            String email = emailEditText.getText().toString().trim();
            if (email.isEmpty()) {
                Toast.makeText(this, "Enter email to receive OTP link", Toast.LENGTH_SHORT).show();
                return;
            }
            sendOTPToGmail(email);
        });

        googleSignInButton.setOnClickListener(v -> signInWithGoogle());

        signUpTextView.setOnClickListener(v -> {
            Intent intent = new Intent(LoginActivity.this, RegisterActivity.class);
            startActivity(intent);
        });
    }

    private void sendOTPToGmail(String email) {
        Log.d("LoginActivity", "Attempting to send sign-in link to: " + email);
        
        ActionCodeSettings actionCodeSettings = ActionCodeSettings.newBuilder()
                .setUrl("https://multi-factor-authenticat-8e8bc.firebaseapp.com/login")
                .setHandleCodeInApp(true)
                .setAndroidPackageName("com.example.crossplatmultifacauth", true, null)
                .build();

        Log.d("LoginActivity", "ActionCodeSettings configured: " + actionCodeSettings.getUrl());

        mAuth.sendSignInLinkToEmail(email, actionCodeSettings)
                .addOnCompleteListener(task -> {
                    if (task.isSuccessful()) {
                        Log.d("LoginActivity", "Sign-in link sent successfully to: " + email);
                        Toast.makeText(LoginActivity.this, "Sign-in link sent to Gmail! Check your inbox.", Toast.LENGTH_LONG).show();
                        getSharedPreferences("PREFS", MODE_PRIVATE).edit().putString("email", email).apply();
                    } else {
                        String errorMessage = task.getException() != null ? task.getException().getMessage() : "Unknown error";
                        Log.e("LoginActivity", "Failed to send sign-in link: " + errorMessage);
                        Toast.makeText(LoginActivity.this, "Failed to send email: " + errorMessage, Toast.LENGTH_LONG).show();
                    }
                });
    }

    private void handleEmailLinkSignIn(Intent intent) {
        String emailLink = intent.getData() != null ? intent.getData().toString() : null;
        Log.d("LoginActivity", "handleEmailLinkSignIn: emailLink=" + emailLink);
        
        if (emailLink != null) {
            Log.d("LoginActivity", "handleEmailLinkSignIn: Checking if valid email link");
        }
        
        if (mAuth.isSignInWithEmailLink(emailLink)) {
            String email = getSharedPreferences("PREFS", MODE_PRIVATE).getString("email", "");
            Log.d("LoginActivity", "handleEmailLinkSignIn: Valid link found, signing in with email=" + email);
            mAuth.signInWithEmailLink(email, emailLink)
                    .addOnCompleteListener(task -> {
                        if (task.isSuccessful()) {
                            Log.d("LoginActivity", "handleEmailLinkSignIn: Sign-in successful, going to dashboard");
                            goToDashboard();
                        } else {
                            String errorMessage = task.getException() != null ? task.getException().getMessage() : "Unknown error";
                            Log.e("LoginActivity", "handleEmailLinkSignIn: Error signing in with link: " + errorMessage);
                            Toast.makeText(this, "Error signing in with link: " + errorMessage, Toast.LENGTH_LONG).show();
                        }
                    });
        } else {
            Log.d("LoginActivity", "handleEmailLinkSignIn: Not a valid email link");
        }
    }

    private void signInWithGoogle() {
        Intent signInIntent = mGoogleSignInClient.getSignInIntent();
        startActivityForResult(signInIntent, RC_SIGN_IN);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == RC_SIGN_IN) {
            Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
            try {
                GoogleSignInAccount account = task.getResult(ApiException.class);
                firebaseAuthWithGoogle(account.getIdToken());
            } catch (ApiException e) {
                Toast.makeText(this, "Google sign in failed: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            }
        }
    }

    private void firebaseAuthWithGoogle(String idToken) {
        AuthCredential credential = GoogleAuthProvider.getCredential(idToken, null);
        mAuth.signInWithCredential(credential)
                .addOnCompleteListener(this, task -> {
                    if (task.isSuccessful()) {
                        goToDashboard();
                    } else {
                        handleSignInError(task.getException());
                    }
                });
    }

    private void handleSignInError(Exception exception) {
        if (exception instanceof FirebaseAuthMultiFactorException) {
            FirebaseAuthMultiFactorException e = (FirebaseAuthMultiFactorException) exception;
            MFASelectionActivity.resolver = e.getResolver();
            Intent intent = new Intent(LoginActivity.this, MFASelectionActivity.class);
            startActivity(intent);
        } else {
            Toast.makeText(LoginActivity.this, "Login failed: " + exception.getMessage(),
                    Toast.LENGTH_LONG).show();
        }
    }

    private void goToDashboard() {
        Intent intent = new Intent(LoginActivity.this, MainActivity.class);
        startActivity(intent);
        finish();
    }
}