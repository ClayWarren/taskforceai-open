#!/bin/bash
#
# Create test account for Apple App Store review
#
# Usage: ./scripts/create-test-account.sh

set -e

API_URL="${API_URL:-https://www.taskforceai.chat}"

echo "Creating Apple Review test account..."
echo "API URL: $API_URL"
echo ""

# Test account credentials. Keep these out of source control and pass them
# explicitly when preparing an App Store review build.
USERNAME="${APP_REVIEW_USERNAME:?Set APP_REVIEW_USERNAME before creating the review account}"
EMAIL="${APP_REVIEW_EMAIL:?Set APP_REVIEW_EMAIL before creating the review account}"
FULL_NAME="${APP_REVIEW_FULL_NAME:-Apple Reviewer}"
PASSWORD="${APP_REVIEW_PASSWORD:?Set APP_REVIEW_PASSWORD before creating the review account}"

echo "Account Details:"
echo "  Username: $USERNAME"
echo "  Email: $EMAIL"
echo "  Full Name: $FULL_NAME"
echo "  Password: $PASSWORD"
echo ""

# Register the account
echo "Registering account..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"$USERNAME\",
    \"email\": \"$EMAIL\",
    \"full_name\": \"$FULL_NAME\",
    \"password\": \"$PASSWORD\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n 1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
  echo "✅ Account created successfully!"
  echo ""
  echo "Account is ready for Apple review."
  echo ""
  echo "Next steps:"
  echo "1. Go to App Store Connect → TestFlight → iOS Builds"
  echo "2. Select your build and click 'Test Information'"
  echo "3. Add these credentials under 'Sign-in information':"
  echo ""
  echo "   Username: $USERNAME"
  echo "   Password: $PASSWORD"
  echo ""
  echo "4. Copy the review notes from apps/mobile/TESTFLIGHT_REVIEW_NOTES.md"
  echo ""
elif [ "$HTTP_CODE" = "409" ]; then
  echo "⚠️  Account already exists!"
  echo ""
  echo "Testing login..."

  # Test login
  LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{
      \"username\": \"$USERNAME\",
      \"password\": \"$PASSWORD\"
    }")

  LOGIN_CODE=$(echo "$LOGIN_RESPONSE" | tail -n 1)

  if [ "$LOGIN_CODE" = "200" ]; then
    echo "✅ Login successful! Account is ready for review."
  else
    echo "❌ Login failed! Password may have changed."
    echo "Response: $(echo "$LOGIN_RESPONSE" | head -n 1)"
    exit 1
  fi
else
  echo "❌ Failed to create account"
  echo "HTTP Status: $HTTP_CODE"
  echo "Response: $BODY"
  exit 1
fi
