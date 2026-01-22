#!/bin/bash
# Test script for backend services
# Run this after starting the dev server: npm run dev

echo "🧪 Testing Backend Services"
echo "================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

BASE_URL="http://localhost:3000"

# Test 1: Identity Resolution - Address
echo -e "${YELLOW}Test 1: Resolve Ethereum Address${NC}"
curl -s -X POST "$BASE_URL/api/identity/resolve" \
  -H "Content-Type: application/json" \
  -d '{"input":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"}' | jq '.'
echo ""
echo ""

# Test 2: Identity Resolution - ENS
echo -e "${YELLOW}Test 2: Resolve ENS Name${NC}"
curl -s -X POST "$BASE_URL/api/identity/resolve" \
  -H "Content-Type: application/json" \
  -d '{"input":"vitalik.eth"}' | jq '.'
echo ""
echo ""

# Test 3: Identity Resolution - Farcaster
echo -e "${YELLOW}Test 3: Resolve Farcaster Handle${NC}"
curl -s -X POST "$BASE_URL/api/identity/resolve" \
  -H "Content-Type: application/json" \
  -d '{"input":"@dwr"}' | jq '.'
echo ""
echo ""

# Test 4: Wallet Analysis
echo -e "${YELLOW}Test 4: Wallet Analysis${NC}"
curl -s "$BASE_URL/api/wallet/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" | jq '.'
echo ""
echo ""

# Test 5: Invalid Input
echo -e "${YELLOW}Test 5: Invalid Input (should error gracefully)${NC}"
curl -s -X POST "$BASE_URL/api/identity/resolve" \
  -H "Content-Type: application/json" \
  -d '{"input":"invalid!!!"}' | jq '.'
echo ""
echo ""

echo -e "${GREEN}✅ Tests Complete${NC}"
echo ""
echo "Note: Some tests may fail if:"
echo "  - Dev server not running (npm run dev)"
echo "  - External APIs (ENS, Farcaster) are down"
echo "  - Rate limits hit"
