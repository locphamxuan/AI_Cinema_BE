**CAPSTONE PROJECT REGISTER**

**Class**: **Duration time**: from 09/2026 To 03/2027

**(\*) Profession:** Software Engineer **Specialty**: SE ![Hộp Văn bản](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAVCAYAAACpF6WWAAAAmklEQVR4Xu2UQQoDIQxF/5G6zsrT5Br2CJ4ml/Ewv6Zj20EGIq2zKMyDgEh4mK+IlBJzzj+XewDc4fjGCtxzSS/pobSyCLyhlbBUo77XQ+uOQLpRixBS6B5TpY0NA1PS/Yk1MnJaSj8uJRj7xaS0ZdnGN48BS8b30T8i0xZDkEEgHbJ8RtBfQ7+4IwLpd/yp9JSfvy9W1Q1n8QDvdQld7Ggx5wAAAABJRU5ErkJggg==)

**(\*) Kinds of person make registers:** Lecturer ![Hộp Văn bản](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAVCAYAAACpF6WWAAAAmklEQVR4Xu2UQQoDIQxF/5G6zsrT5Br2CJ4ml/Ewv6Zj20EGIq2zKMyDgEh4mK+IlBJzzj+XewDc4fjGCtxzSS/pobSyCLyhlbBUo77XQ+uOQLpRixBS6B5TpY0NA1PS/Yk1MnJaSj8uJRj7xaS0ZdnGN48BS8b30T8i0xZDkEEgHbJ8RtBfQ7+4IwLpd/yp9JSfvy9W1Q1n8QDvdQld7Ggx5wAAAABJRU5ErkJggg==) Students

**1\. Register information for supervisor (if have)**

| No.        | Full name         | Phone | **E-Mail**          | **Title**  |
| ---------- | ----------------- | ----- | ------------------- | ---------- |
| Supervisor | Thân Thị Ngọc Vân |       | <vanttn@fpt.edu.vn> | Giảng viên |
| ---        | ---               | ---   | ---                 | ---        |

**2\. Register information for students (if have)**

| **No.** | **Full name** | **Student code** | **Phone** | **E-mail** | **Role in Group** |
| ------- | ------------- | ---------------- | --------- | ---------- | ----------------- |
| 1       |               |                  |           |            |                   |
| ---     | ---           | ---              | ---       | ---        | ---               |
| 2       |               |                  |           |            |                   |
| ---     | ---           | ---              | ---       | ---        | ---               |
| 3       |               |                  |           |            |                   |
| ---     | ---           | ---              | ---       | ---        | ---               |
| 4       |               |                  |           |            |                   |
| ---     | ---           | ---              | ---       | ---        | ---               |
| 5       |               |                  |           |            |                   |
| ---     | ---           | ---              | ---       | ---        | ---               |

**3\. Register content of Capstone Project**

**(\*) 3.1. Capstone Project name:**

3.1.1. English: **_AI Cinema– A Coin-Based Streaming System for AI-Generated Movies_**

3.1.2. Vietnamese: **_AI Cinema–Xây dựng ứng dụng phát trực tuyến phim do AI tạo ra._**

**(\*) 3.2. Main proposal content (including result and product)**

**a) Context:**

Generative Artificial Intelligence for video, voice, and image synthesis has matured to the point where short films and episodic content can be produced largely through AI pipelines rather than traditional filming, opening the door to streaming platforms whose entire content catalog is AI-generated. At the same time, over-the-top streaming services in Vietnam increasingly rely on flexible, wallet-based monetization, such as coin purchases and tiered subscriptions, rather than a single fixed price per title.

This shift coincides with a new and directly relevant legal requirement: Vietnam's Law on Artificial Intelligence No. 134/2025/QH15, passed on 10 December 2025 and effective from 1 March 2026, requires under Article 44 that AI-generated digital products carry identification marks so that users can recognize AI-generated content \[1\]. This requirement was further detailed by Decree No. 142/2026/ND-CP, dated 30 April 2026 and effective from 1 May 2026, whose Article 18 requires deployers who provide AI-generated or AI-edited content to the public, where that content could cause confusion about the authenticity of an event, a character, or the content's origin, to clearly notify and label it \[2\]. For a platform whose entire catalog consists of AI-generated movies, this labeling obligation is not an afterthought but a core, non-negotiable part of the content pipeline.

This project proposes a mobile streaming application, built around a catalog of AI-generated movies, that combines a coin-based payment system with priority spending rules, tiered membership subscriptions with governed auto-renewal, a daily reward-coin mechanism, AI-assisted customer support, and AI-assisted advertising management on TikTok and Facebook. Beyond the operational modules, the platform embeds an AI content generation pipeline and an AI-based compliance labeling engine directly into the publishing workflow, so that every AI-generated movie is automatically labeled in accordance with Vietnam's new AI Law before it becomes viewable, giving the topic both genuine technical novelty and a concrete, timely regulatory basis.

**b) Proposed Solutions:**

Develop a member mobile application and a role-based web portal for a streaming platform built entirely on AI-generated movies, integrating a coin-based payment system, tiered membership, daily rewards, an AI customer support chatbot, and AI-assisted social-media advertising, with AI content generation and compliance labeling embedded in the publishing pipeline.

**System Actors**

1\. Member

· Purchase movies with coins

· Subscribe to membership

· Daily check-in for reward coins

· Chat with AI support

2\. Content Manager

· Run AI content generation pipeline

· Approve and label content

· Set coin pricing

3\. Administrator

· Configure coin and reward rules

· Monitor flagged transactions

· Generate platform reports

The AI content generation pipeline is scoped to integrate with existing third-party generative AI services for script, voice, and image generation, rather than training foundation models from scratch, which keeps the workload feasible while the AI orchestration, compliance-by-design labeling, coin-economy payment logic.

**c) Functional Requirements:**

Develop a member mobile application and a role-based web portal covering movie management, membership, daily rewards, customer support, for a streaming platform whose content catalog is entirely AI-generated.

**_Member_**

The Member shall be able to:

· Register, log in, and manage their profile.

· Browse and search free and paid AI-generated movies.

· Purchase a paid movie per episode or for the full series using coins; if the main coin balance is insufficient, the system shall automatically use bonus coins to cover the shortfall.

· Subscribe to a membership plan (weekly, monthly, or yearly) for unlimited access to all movies on the platform.

· Cancel membership auto-renewal at least 24 hours before the renewal date; if not cancelled in time, the subscription shall automatically renew.

· Check in daily to receive bonus reward coins.

· View their coin balance and transaction history, shown separately for main coins and bonus coins.

· Contact customer support through an AI chatbot, with the option to be escalated to a human agent.

· See a clear on-screen notice identifying that the content being watched was generated or edited by AI.

**_Content Manager_**

The Content Manager shall be able to:

· Upload and manage AI-generated movies, including metadata, episodes, and pricing (free or paid, per-episode or full-series).

· Initiate the AI content generation pipeline for a new movie, covering script drafting, AI voice dubbing, subtitle generation and translation, and poster/thumbnail generation.

· Review and approve AI-generated content before publishing, including verifying that the AI-content label has been correctly applied.

· Configure per-episode and full-series coin pricing.

· View content performance analytics, including views, purchases, and watch time.

**_Membership & Billing Admin_**

The Membership & Billing Admin shall be able to:

· Configure membership plans and pricing for weekly, monthly, and yearly subscriptions.

· Monitor active subscriptions, renewal status, and cancellation requests.

· Configure the mandatory 24-hour pre-renewal cancellation window and the auto-renewal logic.

· View subscription revenue and churn reports.

**_Support Agent_**

The Support Agent shall be able to:

· Receive support conversations escalated by the AI chatbot when a query cannot be resolved automatically.

· View AI-generated conversation summaries and suggested responses.

· Resolve and close support tickets.

**_Administrator_**

The Administrator shall be able to:

· Manage user, staff, and role accounts.

· Configure coin exchange rates, bonus-coin rules, and daily reward values.

· Monitor overall platform activity and flagged issues, such as suspicious coin transactions.

· Generate platform-wide reports.

**_AI Content Generation Pipeline_**

The system shall automatically:

· Generate a movie script draft from a content brief using a large language model.

· Generate voice dubbing and background audio using text-to-speech and AI audio generation services.

· Generate subtitles and translate them into multiple languages.

· Generate poster and thumbnail images using an AI image generation service.

· Assemble the generated script, audio, and visual assets into a packaged episode ready for content manager review.

**_AI Content Labeling & Compliance Engine_**

The system shall automatically:

· Embed a visible on-screen label and a metadata tag identifying content as AI-generated or AI-edited, in accordance with Article 44 of Law No. 134/2025/QH15 and Article 18 of Decree No. 142/2026/ND-CP (Điều 44 Luật số 134/2025/QH15 và Điều 18 Nghị định số 142/2026/NĐ-CP)\[1\]\[2\].

· Verify that every published movie carries a valid AI-content label before it becomes publicly viewable.

· Maintain an audit log of labeling actions for regulatory reporting.

**_AI Recommendation Engine_**

The system shall automatically:

· Recommend movies to each member based on viewing history, genre preference, and viewing patterns.

· Personalize the ranking of free and paid content shown on the home screen.

**_AI Customer Support Chatbot_**

The system shall automatically:

· Answer common member questions about billing, subscription, coin balance, and playback issues using a large language model.

· Detect when a query requires human assistance and escalate the conversation, with a summary, to a Support Agent.

**d) Non-Functional Requirements:**

**_Legal Compliance and Transparency_**

The platform shall ensure that every piece of AI-generated content shown to end users carries a clear, legally compliant AI-content label before publication, in accordance with Vietnam's AI Law and its implementing decree \[1\]\[2\].

**_Payment Integrity_**

Coin deduction logic shall consistently and atomically enforce the main-coin-first, bonus-coin-fallback spending rule to prevent balance inconsistencies, and subscription renewal or cancellation logic shall reliably enforce the 24-hour cancellation window.

**_Scalability and Media Delivery Performance_**

The platform shall support smooth video streaming and shall scale to a growing content catalog and concurrent viewers, using adaptive bitrate streaming and a content delivery network.

**e) Theory & Practical:**

Document: Full 7 reports

Technologies: Suggested technologies include:

· Flutter or React Native (member mobile application).

· ReactJS (role-based web portal for content, membership, marketing, support, and administration).

· Spring Boot or Node.js (backend REST API).

· PostgreSQL and Redis (relational data and coin-wallet/session caching).

· Adaptive bitrate streaming (HLS/DASH) with a content delivery network for video playback.

· A large language model API (script generation, recommendation reasoning, and the support chatbot).

· Text-to-speech and AI image generation APIs (dubbing, subtitles, posters, and thumbnails).

· TikTok Marketing API and Facebook Marketing API (ad campaign management and analytics).

· VNPay or MoMo API (coin top-up and subscription payment).

· Docker (containerized deployment).

**f) Products (Expected Deliverables):**

A member mobile application and a role-based web portal covering content management, membership and billing, marketing, support, and administration.

**g) Proposed Tasks:**

**WP1 Literature Review:** Research AI-generated content platforms, Vietnam's AI Law 2025 content-labeling requirements, and coin-based streaming monetization models.

**WP2 Requirement Analysis:** Analyze the five functional modules, movie management, membership, daily rewards, customer support, and advertising, together with the applicable legal labeling requirements.

**WP3 System Design:** Design the system architecture, database schema for the content catalog, coin wallet, and subscriptions, REST APIs, and the AI pipeline and labeling workflow.

**WP4 Member Mobile Application Development:** Develop browsing, purchase, membership, daily reward, and support chat features.

**WP5 Content Management and AI Generation/Labeling Pipeline:** Develop the content manager portal and the AI content generation and compliance labeling engine.

**WP6 Membership, Coin Wallet, and Marketing Modules:** Implement subscription/auto-renewal logic, the coin wallet with priority spending rules, the AI recommendation engine, coin-anomaly detection, and the TikTok/Facebook ad management module with AI-assisted creative generation.

**WP7 Testing and Documentation:** Conduct system testing, including payment and renewal edge cases, and user acceptance testing, and prepare the thesis report, technical documentation, and demonstration.

**4\. Other comments (propose all relative things if have):**

............................................................................................................................................................

............................................................................................................................................................

............................................................................................................................................................

| **Supervisor (If have)**<br><br>_(Sign and full name)_ | HCM, date 19/08/2026<br><br>**On behalf of Registers**<br><br>_(Sign and full name)_ |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |