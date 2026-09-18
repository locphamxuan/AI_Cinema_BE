# Main Flow 1 - AI Movie Production & Publishing

## Overview

This workflow describes the end-to-end process for producing and publishing an AI-generated movie or episode.

The workflow involves two main actors:

- **Content Reviewer**
  - Defines the movie concept and production requirements.
  - Reviews and approves production plans.
  - Reviews the final generated content.
- **Content Creator**
  - Prepares the production plan.
  - Generates AI video content.
  - Revises the production plan or AI-generated content based on reviewer feedback.

The overall workflow is:

1. Create Production Project
2. Prepare Production Plan
3. Submit Production Plan
4. Review Production Plan
5. Approve or request changes
6. Allocate AI Quota
7. Produce AI Video
8. Submit Episode
9. Review Final Content
10. Approve or request content changes
11. Perform Compliance Check
12. Schedule Film
13. Publish Content

---

# 1. Create Production Project

**Actor:** Content Reviewer

The Content Reviewer creates a new production project and defines the initial production requirements.

### Inputs

- Movie concept
- Project structure
- Episode requirements
- Production deadline
- Planned release date

### Actions

- Define the movie concept.
- Define the project and episode structure.
- Define production requirements.
- Define the production deadline.
- Define the planned release date.

### Next Step

After the production project is created:

`Create Production Project -> Prepare Production Plan`

---

# 2. Prepare Production Plan

**Actor:** Content Creator

The Content Creator prepares a detailed production plan for the assigned episode.

### Actions

The creator defines:

- Script
- Scene breakdown
- Production approach
- Target duration
- Estimated AI resource usage

### Next Step

`Prepare Production Plan -> Submit Production Plan`

---

# 3. Submit Production Plan

**Actor:** Content Creator

The Content Creator submits the completed production plan to the Content Reviewer.

### Purpose

The production plan must be reviewed and approved before AI video production begins.

### Next Step

`Submit Production Plan -> Review Production Plan`

---

# 4. Review Production Plan

**Actor:** Content Reviewer

The Content Reviewer reviews the submitted production plan.

The reviewer can either:

- Approve the production plan.
- Request changes to the production plan.

### Decision

`Production Plan Approved?`

---

# 5. Production Plan Approval Decision

## 5.1 Approved

If the production plan is approved:

`Production Plan Approved = Yes`

Then the system proceeds to:

`Allocate AI Quota`

---

## 5.2 Not Approved

If the production plan is not approved:

`Production Plan Approved = No`

The Content Reviewer provides review comments and requests changes.

Next:

`Request Plan Changes -> Revise Production Plan`

---

# 6. Request Plan Changes

**Actor:** Content Reviewer

The Content Reviewer provides feedback on the submitted production plan.

### Actions

- Provide review comments.
- Identify required changes.
- Request the Content Creator to revise the production plan.

### Next Step

`Request Plan Changes -> Revise Production Plan`

---

# 7. Revise Production Plan

**Actor:** Content Creator

The Content Creator updates the production plan based on the reviewer's feedback.

### Actions

- Review reviewer comments.
- Modify the production plan.
- Update the script, scene breakdown, production approach, duration, or estimated AI resource usage as required.
- Resubmit the revised production plan.

### Next Step

`Revise Production Plan -> Submit Production Plan`

The revised plan goes through the production plan review process again.

### Loop

```text
Submit Production Plan
        |
        v
Review Production Plan
        |
        v
Production Plan Approved?
        |
   +----+----+
   |         |
  Yes        No
   |         |
   v         v
Allocate   Request Plan Changes
AI Quota       |
               v
        Revise Production Plan
               |
               v
        Submit Production Plan

8. Allocate AI Quota

Actor: System / Production Management

AI generation resources are allocated to the approved episode.

Purpose

Allocate an AI generation quota based on:

Approved production project
Available production project budget
Estimated AI resource usage
Actions
Determine the available AI generation quota.
Allocate the quota to the approved episode.
Associate the allocated quota with the production episode.
Next Step

Allocate AI Quota -> Produce AI Video

9. Produce AI Video

Actor: Content Creator / AI Production System

The episode's AI-generated video is produced using the allocated AI quota.

Actions
Generate AI video assets.
Assemble the generated video.
Track AI resource usage.
Associate generated assets with the episode.
Next Step

Produce AI Video -> Submit Episode

10. Submit Episode

Actor: Content Creator

The Content Creator submits the completed episode for final content review.

Purpose

The completed episode must be reviewed before it can proceed to compliance checking and publication.

Next Step

Submit Episode -> Review Final Content

11. Review Final Content

Actor: Content Reviewer

The Content Reviewer reviews the submitted episode.

The reviewer can either:

Approve the final content.
Request changes to the submitted episode.
Decision

Final Content Approved?

12. Final Content Approval Decision
12.1 Approved

If the final content is approved:

Final Content Approved = Yes

The episode proceeds to:

Compliance Check

12.2 Not Approved

If the final content is not approved:

Final Content Approved = No

The reviewer requests content changes.

Next:

Request Content Changes -> Revise AI Video

13. Request Content Changes

Actor: Content Reviewer

The Content Reviewer provides feedback and requests revisions to the submitted episode.

Actions
Review the submitted episode.
Identify content issues.
Provide revision feedback.
Request the Content Creator to revise the episode.
Next Step

Request Content Changes -> Revise AI Video

14. Revise AI Video

Actor: Content Creator

The Content Creator updates the AI-generated video and related assets based on reviewer feedback.

Actions
Review content feedback.
Modify the AI-generated video.
Update related assets.
Produce a revised version.
Submit the revised episode for review.
Next Step

Revise AI Video -> Submit Episode

The revised episode goes through the final content review process again.

Loop
Submit Episode
      |
      v
Review Final Content
      |
      v
Final Content Approved?
      |
   +--+--+
   |     |
  Yes    No
   |     |
   v     v
Compliance  Request Content Changes
Check           |
                v
         Revise AI Video
                |
                v
         Submit Episode
15. Compliance Check

Actor: Compliance / System

After final content approval, the content must pass compliance and publishing requirements before it can be scheduled.

Purpose

Verify that the approved content satisfies all required:

Legal requirements
Compliance requirements
Publishing requirements
Decision

Does the content meet all requirements?

16. Compliance Decision
16.1 Compliance Requirements Met

If all compliance requirements are satisfied:

Compliance Check = Pass

The episode proceeds to:

Schedule Film

16.2 Compliance Requirements Not Met

If the content fails to meet legal or compliance requirements:

Compliance Check = Fail

The content must be revised.

Next:

Compliance Check -> Revise AI Video

The revised content must then be submitted and reviewed again.

Loop
Review Final Content
      |
      v
Final Content Approved?
      |
     Yes
      |
      v
Compliance Check
      |
      v
All Requirements Met?
      |
   +--+--+
   |     |
  Yes    No
   |     |
   v     v
Schedule  Revise AI Video
Film          |
              v
       Submit Episode
              |
              v
       Review Final Content
17. Schedule Film

Actor: Content Reviewer / System

Once the episode passes compliance checking, the release is scheduled.

Actions
Set the release date.
Set the release time.
Associate the release schedule with the approved episode.
Next Step

Schedule Film -> Publish Content

18. Publish Content

Actor: System / Publishing Platform

The approved and compliant movie or episode is published according to the release schedule.

Actions
Publish the approved content.
Make the movie or episode available on the platform.
Follow the configured release schedule.
End State

The movie or episode is successfully published.

Complete End-to-End Flow

Content Reviewer
      |
      v
Create Production Project
      |
      v
Content Creator
      |
      v
Prepare Production Plan
      |
      v
Submit Production Plan
      |
      v
Content Reviewer
      |
      v
Review Production Plan
      |
      v
Production Plan Approved?
      |
      +-------------------- No --------------------+
      |                                             |
     Yes                                            v
      |                                    Request Plan Changes
      v                                             |
Allocate AI Quota                                   v
      |                                    Revise Production Plan
      v                                             |
Produce AI Video <---------------------------------+
      |
      v
Submit Episode
      |
      v
Review Final Content
      |
      v
Final Content Approved?
      |
      +-------------------- No --------------------+
      |                                             |
     Yes                                            v
      |                                    Request Content Changes
      v                                             |
Compliance Check                                    v
      |                                      Revise AI Video
      v                                             |
All Requirements Met?                               |
      |                                             |
      +-------------------- No ---------------------+
      |                                             |
     Yes                                            |
      |                                             |
      v                                             |
Schedule Film                                       |
      |                                             |
      v                                             |
Publish Content <----------------------------------+

Business Rules
Production Plan Rules
An episode must have a production plan before AI video production begins.
A production plan must be approved by the Content Reviewer before AI resources are allocated.
If the production plan is rejected, the Content Creator must revise and resubmit it.
The production plan review process can repeat multiple times until approval is obtained.
AI Resource Rules
AI generation quota is allocated only after the production plan is approved.
AI quota is based on the approved production project budget.
AI resource usage must be tracked during video production.
Content Review Rules
An episode must be submitted for final content review after production.
Final content must be approved before compliance checking.
If the reviewer requests changes, the Content Creator must revise the AI video and resubmit the episode.
Final content review can repeat multiple times.
Compliance Rules
Approved content must pass compliance checking before publication.
Compliance checking verifies legal, compliance, and publishing requirements.
Content that fails compliance checking must be revised.
Revised content must go through the content review process again.
Publishing Rules
Only approved and compliant content can be scheduled.
A release date and time must be configured before publication.
Content is published according to its configured release schedule.
Actors
Content Reviewer

Responsibilities:

Create production projects.
Define movie and episode requirements.
Review production plans.
Approve or reject production plans.
Provide production plan feedback.
Review final episodes.
Approve or request changes to final content.
Define or approve release scheduling where applicable.
Content Creator

Responsibilities:

Prepare production plans.
Define scripts and scene breakdowns.
Estimate AI resource usage.
Revise production plans.
Produce AI-generated video.
Revise AI-generated video.
Submit production plans and episodes for review.
System / AI Production System

Responsibilities:

Allocate AI generation quota.
Track AI resource usage.
Generate and assemble AI video assets.
Perform or support compliance checking.
Schedule releases.
Publish approved content.
Important State Transitions

An episode generally moves through the following states:
Production Project Created
        |
        v
Production Plan Draft
        |
        v
Production Plan Submitted
        |
        +----> Plan Changes Requested
        |             |
        |             v
        |       Production Plan Revised
        |             |
        +-------------+
        |
        v
Production Plan Approved
        |
        v
AI Quota Allocated
        |
        v
AI Video Produced
        |
        v
Episode Submitted
        |
        +----> Content Changes Requested
        |             |
        |             v
        |       AI Video Revised
        |             |
        +-------------+
        |
        v
Final Content Approved
        |
        v
Compliance Checked
        |
        +----> Compliance Failed
        |             |
        |             v
        |       AI Video Revised
        |             |
        +-------------+
        |
        v
Content Compliant
        |
        v
Film Scheduled
        |
        v
Content Published

Key Decision Points
Decision	Yes	No
Production Plan Approved?	Allocate AI Quota	Request Plan Changes
Final Content Approved?	Compliance Check	Request Content Changes
Compliance Requirements Met?	Schedule Film	Revise AI Video
Main Workflow Summary

Create Project
    -> Prepare Production Plan
    -> Submit Production Plan
    -> Review Production Plan
    -> [Plan Approved?]
        -> No: Request Changes -> Revise Plan -> Submit Again
        -> Yes: Allocate AI Quota
    -> Produce AI Video
    -> Submit Episode
    -> Review Final Content
    -> [Final Content Approved?]
        -> No: Request Changes -> Revise AI Video -> Submit Again
        -> Yes: Compliance Check
    -> [Compliance Passed?]
        -> No: Revise AI Video -> Submit Episode -> Review Again
        -> Yes: Schedule Film
    -> Publish Content