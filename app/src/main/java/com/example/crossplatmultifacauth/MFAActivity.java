package com.example.crossplatmultifacauth;

import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.FirebaseException;
import com.google.firebase.auth.AuthResult;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.MultiFactorAssertion;
import com.google.firebase.auth.MultiFactorInfo;
import com.google.firebase.auth.MultiFactorResolver;
import com.google.firebase.auth.PhoneAuthCredential;
import com.google.firebase.auth.PhoneAuthOptions;
import com.google.firebase.auth.PhoneAuthProvider;
import com.google.firebase.auth.PhoneMultiFactorGenerator;
import com.google.firebase.auth.PhoneMultiFactorInfo;

import java.util.concurrent.TimeUnit;

public class MFAActivity extends AppCompatActivity {

    public static MultiFactorResolver resolver;
    private EditText verificationCodeEditText;
    private Button verifyButton;
    private String verificationId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_mfa);

        verificationCodeEditText = findViewById(R.id.verificationCodeEditText);
        verifyButton = findViewById(R.id.verifyButton);

        if (resolver == null) {
            Toast.makeText(this, "Error: No MFA resolver found", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        // Send the verification code to the first available factor (usually SMS)
        MultiFactorInfo selectedHint = resolver.getHints().get(0);
        if (selectedHint instanceof PhoneMultiFactorInfo) {
            sendVerificationCode((PhoneMultiFactorInfo) selectedHint);
        }

        verifyButton.setOnClickListener(v -> {
            String code = verificationCodeEditText.getText().toString().trim();
            if (code.isEmpty()) {
                Toast.makeText(MFAActivity.this, "Enter code", Toast.LENGTH_SHORT).show();
                return;
            }
            verifyCode(code);
        });
    }

    private void sendVerificationCode(PhoneMultiFactorInfo phoneInfo) {
        PhoneAuthOptions options = PhoneAuthOptions.newBuilder()
                .setMultiFactorHint(phoneInfo)
                .setMultiFactorSession(resolver.getSession())
                .setActivity(this)
                .setTimeout(30L, TimeUnit.SECONDS)
                .setCallbacks(new PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
                    @Override
                    public void onVerificationCompleted(@NonNull PhoneAuthCredential credential) {
                        // Automatically verified in some cases
                    }

                    @Override
                    public void onVerificationFailed(@NonNull FirebaseException e) {
                        Toast.makeText(MFAActivity.this, "Verification failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    }

                    @Override
                    public void onCodeSent(@NonNull String vId, @NonNull PhoneAuthProvider.ForceResendingToken token) {
                        verificationId = vId;
                        Toast.makeText(MFAActivity.this, "Code sent to " + phoneInfo.getPhoneNumber(), Toast.LENGTH_SHORT).show();
                    }
                })
                .build();
        PhoneAuthProvider.verifyPhoneNumber(options);
    }

    private void verifyCode(String code) {
        MultiFactorAssertion assertion = PhoneMultiFactorGenerator.getAssertion(
                PhoneAuthProvider.getCredential(verificationId, code));

        resolver.resolveSignIn(assertion)
                .addOnCompleteListener(new OnCompleteListener<AuthResult>() {
                    @Override
                    public void onComplete(@NonNull Task<AuthResult> task) {
                        if (task.isSuccessful()) {
                            Intent intent = new Intent(MFAActivity.this, MainActivity.class);
                            startActivity(intent);
                            finish();
                        } else {
                            Toast.makeText(MFAActivity.this, "MFA failed: " + task.getException().getMessage(), Toast.LENGTH_SHORT).show();
                        }
                    }
                });
    }
}