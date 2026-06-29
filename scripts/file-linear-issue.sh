#!/usr/bin/env bash
set -euo pipefail

# Files (or comments on) a rolling Linear issue for the bcycle-map project.
# Mirrors the old "one open GitHub issue per label" behavior: if an open issue
# with the same title already exists in the project, append a comment;
# otherwise create a new one.
#
# Required env:
#   LINEAR_API_KEY - Linear personal API key
#   TITLE          - issue title (also the dedupe key)
#   BODY           - markdown body / comment
# Optional env (default to the bcycle-map project in the Gutentag team):
#   LINEAR_PROJECT_ID
#   LINEAR_TEAM_ID

: "${LINEAR_API_KEY:?LINEAR_API_KEY is required}"
: "${TITLE:?TITLE is required}"
: "${BODY:?BODY is required}"

LINEAR_PROJECT_ID="${LINEAR_PROJECT_ID:-b65a59b7-697c-4b65-a419-8276e2213f25}"
LINEAR_TEAM_ID="${LINEAR_TEAM_ID:-0abe26aa-0c19-47d1-92ca-037d4fc2935e}"
API="https://api.linear.app/graphql"

gql() {
  # $1 = query, $2 = variables JSON
  local payload
  payload=$(jq -n --arg q "$1" --argjson v "$2" '{query: $q, variables: $v}')
  curl -sS -X POST "$API" \
    -H "Authorization: $LINEAR_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

# 1. Look for an existing open issue with this title in the project.
FIND_Q='query($projectId: ID!, $title: String!) {
  issues(filter: {
    project: { id: { eq: $projectId } },
    title: { eq: $title },
    state: { type: { nin: ["completed", "canceled"] } }
  }) { nodes { id identifier url } }
}'
FIND_V=$(jq -n --arg projectId "$LINEAR_PROJECT_ID" --arg title "$TITLE" \
  '{projectId: $projectId, title: $title}')
FIND_RESP=$(gql "$FIND_Q" "$FIND_V")

# Surface API errors instead of silently creating duplicates.
if echo "$FIND_RESP" | jq -e '.errors' >/dev/null 2>&1; then
  echo "Linear query failed:" >&2
  echo "$FIND_RESP" | jq -r '.errors[].message' >&2
  exit 1
fi

ISSUE_ID=$(echo "$FIND_RESP" | jq -r '.data.issues.nodes[0].id // empty')

if [ -n "$ISSUE_ID" ]; then
  IDENT=$(echo "$FIND_RESP" | jq -r '.data.issues.nodes[0].identifier')
  echo "Existing open issue $IDENT — adding a comment."
  C_Q='mutation($input: CommentCreateInput!) {
    commentCreate(input: $input) { success comment { id } }
  }'
  C_V=$(jq -n --arg issueId "$ISSUE_ID" --arg body "$BODY" \
    '{input: {issueId: $issueId, body: $body}}')
  RESP=$(gql "$C_Q" "$C_V")
  echo "$RESP" | jq -e '.data.commentCreate.success == true' >/dev/null \
    || { echo "Comment failed: $RESP" >&2; exit 1; }
  echo "Commented on $IDENT."
else
  echo "No open issue found — creating one."
  I_Q='mutation($input: IssueCreateInput!) {
    issueCreate(input: $input) { success issue { identifier url } }
  }'
  I_V=$(jq -n \
    --arg teamId "$LINEAR_TEAM_ID" \
    --arg projectId "$LINEAR_PROJECT_ID" \
    --arg title "$TITLE" \
    --arg body "$BODY" \
    '{input: {teamId: $teamId, projectId: $projectId, title: $title, description: $body}}')
  RESP=$(gql "$I_Q" "$I_V")
  echo "$RESP" | jq -e '.data.issueCreate.success == true' >/dev/null \
    || { echo "Create failed: $RESP" >&2; exit 1; }
  echo "Created $(echo "$RESP" | jq -r '.data.issueCreate.issue.identifier') — $(echo "$RESP" | jq -r '.data.issueCreate.issue.url')"
fi
