import os
import requests
import sys

LINEAR_API_KEY = os.getenv("LINEAR_API_KEY")
if not LINEAR_API_KEY:
    print("Error: LINEAR_API_KEY environment variable not set.")
    sys.exit(1)

URL = "https://api.linear.app/graphql"
HEADERS = {
    "Authorization": f"Bearer {LINEAR_API_KEY}",
    "Content-Type": "application/json"
}

def execute_query(query, variables=None):
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    response = requests.post(URL, json=payload, headers=HEADERS)
    response.raise_for_status()
    return response.json()

def get_viewer_team_and_project():
    query = """
    query {
      viewer {
        team {
          id
        }
      }
      projects(filter: { name: { eq: "Epic 5: Live Brokerage Sandbox Validation & Multi-Strategy Portfolio Rebalancing" } }) {
        nodes {
          id
        }
      }
    }
    """
    result = execute_query(query)
    # Note: viewer logic might differ based on token type, so we fetch teams if viewer fails
    team_query = """
    query {
      teams {
        nodes {
          id
          name
        }
      }
    }
    """
    team_result = execute_query(team_query)
    team_id = team_result['data']['teams']['nodes'][0]['id'] # Just grab the first team

    project_id = None
    if result.get('data', {}).get('projects', {}).get('nodes'):
        project_id = result['data']['projects']['nodes'][0]['id']

    return team_id, project_id

def create_issue(team_id, project_id, title, description):
    mutation = """
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          title
        }
      }
    }
    """
    input_data = {
        "teamId": team_id,
        "title": title,
        "description": description
    }
    if project_id:
        input_data["projectId"] = project_id

    result = execute_query(mutation, {"input": input_data})
    if not result.get('data', {}).get('issueCreate', {}).get('success'):
         print(f"Failed to create issue {title}: {result}")
         sys.exit(1)
    return result['data']['issueCreate']['issue']['id']

def create_relation(issue_id, related_issue_id, type_):
    mutation = """
    mutation IssueRelationCreate($input: IssueRelationCreateInput!) {
      issueRelationCreate(input: $input) {
        success
      }
    }
    """
    input_data = {
        "issueId": issue_id,
        "relatedIssueId": related_issue_id,
        "type": type_
    }
    result = execute_query(mutation, {"input": input_data})
    if not result.get('data', {}).get('issueRelationCreate', {}).get('success'):
         print(f"Failed to create relation between {issue_id} and {related_issue_id}: {result}")

def main():
    team_id, project_id = get_viewer_team_and_project()
    print(f"Using Team ID: {team_id}, Project ID: {project_id}")

    tickets = [
        {
            "title": "Broker Sandbox Integration",
            "desc": "**Scope:** `pkg/robinhood/sandbox.go`, `pkg/robinhood/mcp.go`\n\n**Objective:** Implement OAuth PKCE token manager for Robinhood/Tradier sandbox environments and establish dry-run telemetry execution pathways to avoid real capital deployment.\n\n**Acceptance Criteria:**\n- Verify `go test -race ./pkg/robinhood/...` passes and dry-run payloads write successfully to `gelt_journal.db`",
            "blockers": []
        },
        {
            "title": "Dynamic Portfolio Rebalancing",
            "desc": "**Scope:** `pkg/portfolio/rebalancer.go`, `pkg/portfolio/manager.go`\n\n**Objective:** Implement dynamic weight adjustments that safely consume real-time SQLite trade journal metrics during concurrent multi-strategy evaluations without creating write-lock bottlenecks.\n\n**Acceptance Criteria:**\n- Verify `go test -race ./pkg/portfolio/...` passes and concurrent strategy evaluations correctly update weights without SQLite locking errors",
            "blockers": [0]
        },
         {
            "title": "Fail-Safe Integration Drills",
            "desc": "**Scope:** `pkg/risk/failsafe.go`, `pkg/portfolio/manager.go`\n\n**Objective:** Implement sandbox integration drills to simulate order failures and test the PortfolioManager's signal resolution and capital protection logic under edge cases.\n\n**Acceptance Criteria:**\n- Verify simulated API failure rates correctly trigger the Fail-Safe and halt subsequent sandbox order submissions",
            "blockers": [0]
        },
        {
            "title": "Operational Runbook",
            "desc": "**Scope:** `docs/runbooks/epic_5_live_brokerage.md`\n\n**Objective:** Finalize the operational runbook detailing sandbox deployment procedures, thread-safety guidelines for SQLite telemetry, and monitoring requirements for the multi-strategy rebalancer.\n\n**Acceptance Criteria:**\n- Verify the runbook is complete, reviewed by the architectural team, and properly linked in the OKF documentation system",
            "blockers": [1, 2]
        }
    ]

    issue_ids = []
    for i, t in enumerate(tickets):
        issue_id = create_issue(team_id, project_id, t['title'], t['desc'])
        print(f"Created issue {t['title']} with ID {issue_id}")
        issue_ids.append(issue_id)

        for blocker_index in t['blockers']:
            create_relation(issue_ids[blocker_index], issue_id, "blocks")
            print(f"Created relation: {issue_ids[blocker_index]} blocks {issue_id}")

if __name__ == "__main__":
    main()
