#!/bin/bash
# usage: run.sh <runName> <functionsHost>
S=/tmp/claude-0/-home-user-goarrive/071fd334-e52c-5783-86f3-2ea356df0607/scratchpad/w5p491; R=$S/$1; mkdir -p $R
node $S/enumerate.mjs > $R/enum-before.json
cd /tmp/w5p-491 && WSF_PRIVACY_TARGET=emulator WSF_PRIVACY_PROJECT=demo-wsf-local FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 WSF_FUNCTIONS_EMULATOR_HOST=$2 WSF_CLEANUP_MANIFEST=$R/manifest.json WSF_RESULT_DIR=$R node .github/wsf-staging/social-privacy-postop.mjs > $R/harness.log 2>&1
echo EXIT=$? >> $R/harness.log
TAG=$(grep -o 'e5p-[a-z0-9]*-[a-f0-9]*' $R/harness.log | head -1)
MANIFEST=$R/manifest.json TAG=$TAG node $S/enumerate.mjs > $R/enum-after.json
cat $R/harness.log
node -e 'const b=require(process.argv[1]),a=require(process.argv[2]),m=require(process.argv[3]);console.log(`STATE docs ${b.docCount}->${a.docCount} users ${b.userCount}->${a.userCount}; taggedDocs=${a.taggedDocs.length} taggedUsers=${a.taggedUsers.length}; manifest users=${m.users.length} docs=${m.docs.length}; notInManifest=${JSON.stringify(a.diff.presentNotInManifest.filter(d=>!b.docs.includes(d)))} usersNotInManifest=${a.diff.usersNotInManifest.filter(u=>!b.users.some(x=>x.uid===u.uid)).length}`)' $R/enum-before.json $R/enum-after.json $R/manifest.json
