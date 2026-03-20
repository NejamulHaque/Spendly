#!/bin/bash
# ============================================================
#  Nestfy — deploy.sh
#  Run this INSTEAD of "firebase deploy --only hosting"
#  It auto-bumps the SW version so mobile gets fresh files.
# ============================================================

echo "🚀 Nestfy Deploy Script"
echo ""

# Auto-bump service worker version with current timestamp
TIMESTAMP=$(date +%s)
NEW_VERSION="nestfy-v${TIMESTAMP}"

# Replace VERSION in sw.js
sed -i.bak "s/const VERSION *= *'nestfy-v[^']*'/const VERSION = '${NEW_VERSION}'/" sw.js
rm -f sw.js.bak

echo "✅ SW version bumped to: ${NEW_VERSION}"
echo "✅ Deploying to Firebase Hosting..."
echo ""

firebase deploy --only hosting

echo ""
echo "✅ Deploy complete! Mobile users will see the update banner."