---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
inputDocuments:
  - _bmad-output/project-context.md
  - docs/README.md
  - docs/architecture.md
  - docs/authorization.md
  - docs/database-er.md
  - docs/test-strategy.md
  - docs/research/main.md
  - docs/research/coupon.md
  - docs/research/organization.md
documentCounts:
  briefCount: 0
  researchCount: 3
  brainstormingCount: 0
  projectDocsCount: 5
  projectContextCount: 1
classification:
  projectType: saas_b2b
  domain: edtech
  complexity: medium
  projectContext: brownfield
workflowType: 'prd'
---

# Product Requirements Document - reserve-app

**Author:** Yusuke
**Date:** 2026-04-07

## Executive Summary

本PRDは、既存の予約管理 SaaS `reserve-app` に対して、組織単位のサブスクリプション課金基盤を整備するための要件を定義する。対象顧客はスクール、料理教室などの lesson / classroom 型事業者であり、支払い主体は participant ではなく organization を管理する owner/operator とする。

本プロダクトはすでに `organization + classroom` の2階層モデル、予約、参加者管理、招待、回数券、Web / Mobile クライアントを持つ brownfield システムである。今回の課金整備は、その既存運用モデルを壊さずに、無料プランと有料プランの境界、有料機能の解放条件、トライアルから本登録までの導線を組織単位で一貫させることを目的とする。

無料プランは一時的な体験版ではなく、`1組織・1教室` で基本運用を成立させる永続利用可能な階層として維持する。一方で有料プランでは、複数教室管理、スタッフ招待と権限管理、定期スケジュール、承認制予約、回数券、月額課金、Stripe 本番運用、契約管理、参加者招待の本格運用、CSV出力、分析、監査ログ、優先サポートといった、事業運営が拡大した時に必要になる機能を解放する。

有料機能には 7 日間のトライアルを提供する。トライアル終了後に支払い方法が登録されていれば本登録を開始し、`customer.subscription.trial_will_end` を契機として終了 3 日前に本登録案内メールを送る。これにより、運営者は低い心理的負担で有料機能の価値を確認し、継続判断を行える。

### What Makes This Special

このプロダクトの差別化要因は、課金を単独の決済機能として追加するのではなく、既存の `organization / classroom` モデル、権限設計、予約運用と整合した「運営者向けの拡張レイヤー」として設計する点にある。汎用的な決済リンクや単純なプラン販売ではなく、教室運営の複雑性に応じて必要な管理能力を段階的に解放する構造を取る。

また、無料プランを永続提供することにより、導入の障壁を下げつつ、実運用の中で有料機能の必要性が自然に顕在化する設計にする。つまり、価値訴求の中心は「支払いができること」ではなく、「拠点・スタッフ・スケジュール・契約・分析までを含む運営管理がスケールすること」に置く。

このアプローチにより、運営者は最初から重い契約判断を迫られず、小規模運用から開始し、成長や複雑化のタイミングで有料プランへ移行できる。結果として、無料導入のしやすさと、有料転換時の納得感を両立できる。

## Project Classification

- Project Type: `saas_b2b`
- Domain: `edtech`
- Complexity: `medium`
- Project Context: `brownfield`

## Success Criteria

### User Success

owner/operator がサポートなしで組織単位の 7 日間トライアルを開始できること。無料機能と有料機能の違いを UI 上で理解でき、トライアル期間中に有料機能の価値を把握できること。トライアル終了前に支払い方法を登録でき、リマインダーメールを受信し、トライアル終了後に中断なく有料プランへ移行できること。

### Business Success

無料プランから有料機能トライアルへの導線が成立し、一定割合の trial organization が終了前に支払い方法を登録すること。trial organization の一部がそのまま paid organization へ移行し、課金開始のために手動対応を要するケースが限定的であること。課金導線の導入により、owner 向けの monetization が継続可能な運用フローとして成立すること。

### Technical Success

Stripe 上の subscription 状態とアプリケーション側の organization billing 状態がドリフトしないこと。`customer.subscription.trial_will_end` を起点にした 3 日前リマインダーメールが期待通り送信されること。trial 終了時に entitlement と plan 状態が正しく切り替わること。無料組織へ有料機能が誤って開放されず、有料組織が権限を失う誤判定も起きないこと。Webhook の重複受信や順不同受信が起きても billing state が破壊されないこと。

### Measurable Outcomes

- owner がサポートなしで trial 開始から payment method 登録まで完了できる
- trial organization の payment method 登録率を主要指標として継続監視できる
- trial から paid への移行率を計測できる
- reminder email の送信成功率を計測できる
- Stripe subscription 状態と organization billing 状態の不整合件数をゼロ、または運用上無視できる水準に保つ
- 課金起因の手動サポート対応件数を継続的に把握できる

## Product Scope

### MVP - Minimum Viable Product

- organization 単位の free / trial / paid プラン状態管理
- 有料機能の entitlement 制御
- 7 日間 trial 開始導線
- payment method 登録導線
- trial 終了後、支払い方法登録済み organization の paid 移行
- `customer.subscription.trial_will_end` を利用した 3 日前リマインダーメール
- Stripe と organization billing state の同期
- billing 状態を owner が確認できる最低限の管理 UI / 導線

### Growth Features (Post-MVP)

- plan 変更、アップグレード、ダウングレードの整備
- 課金失敗時のリトライ導線と通知強化
- 請求履歴、契約管理、管理者向け billing 可視化の拡充
- より詳細な free / paid 機能訴求 UI
- trial / conversion の分析ダッシュボード
- サポート運用を減らす self-serve billing 管理

### Vision (Future)

- 組織成長に応じた段階的プラン設計
- billing と運営機能を結びつけた高度な契約・権限モデル
- 利用状況に応じた upgrade 提案や plan 最適化
- billing / contract / analytics を一体化した経営向け運用基盤

## User Journeys

### Journey 1: Owner / Operator - Happy Path

佐藤美咲は、小規模な料理教室を運営している。いまは `1組織・1教室` で無料プランを使いながら、単発予約枠の作成や公開予約ページ、基本的な参加者管理までは問題なく運用できている。ただ、講師を増やし、定期開催のクラスを整備し、複数拠点も見据え始めたところで、無料プランでは運営の限界が見え始める。

管理画面で美咲は、有料プランで解放される機能を確認する。複数教室管理、スタッフ招待、定期スケジュール、承認制予約、回数券、契約管理、分析などが、自分の次の運営フェーズに直結していることを理解する。そこで 7 日間トライアルを開始する。

トライアル期間中、美咲は実際にスタッフ招待や定期スケジュールなどの有料機能を試し、「これは今の運営に必要だ」と実感する。トライアル終了 3 日前、`customer.subscription.trial_will_end` を起点とした案内メールを受け取り、支払い方法を登録する。トライアル終了後、利用中の有料機能は中断されず、そのまま paid organization として継続運用に移行する。

この journey が成功するとき、美咲は「難しい契約手続きなしで、必要になった機能を自然に使い始め、そのまま継続できた」と感じる。

### Journey 2: Owner / Operator - Edge Case / Recovery Path

田中健一は学習塾の owner で、有料機能のトライアルを開始したものの、普段は現場対応に追われており、すぐには支払い方法を登録しない。トライアル期間中は複数教室管理とスタッフ権限を試し、価値は理解しているが、 billing 設定そのものは後回しになっている。

トライアル終了 3 日前、健一は reminder email を受け取る。メールと管理画面の双方で、「いつ trial が終わるか」「何をしないとどうなるか」「どの機能が paid 対象か」を明確に把握できる必要がある。ここで導線が曖昧だと、健一は「後でやろう」と先送りし、 trial 終了時に混乱する。

理想的には、健一はメールまたは管理画面からそのまま payment method 登録へ進み、 paid へ途切れなく移行する。失敗パスとしては、支払い方法未登録のまま trial が終了するケースもある。この場合でも、どの機能が free に戻り、どのデータや設定は保持されるのかが明確でなければならない。健一が「勝手に壊れた」「何が止まったのか分からない」と感じたら、この journey は失敗である。

この journey は、 reminder の分かりやすさ、 downgrade / entitlement 切替の明確さ、 owner 向け recovery UX を要求する。

### Journey 3: Staff / Classroom Manager - Secondary User Experience

山本彩は、料理教室の staff manager として日々の予約運用を担当している。billing の契約者ではないが、 organization が paid になることで解放されるスタッフ招待、権限管理、定期スケジュール、承認制予約などを現場で使う立場にある。

彩にとって重要なのは、 owner が paid に移行した結果として、自分の業務がどう変わるかが一貫していることだ。trial 中や paid 移行後に、招待された staff が適切に権限を持ち、必要な管理機能へアクセスできる必要がある。一方で billing 管理そのものは owner に閉じており、staff には不要な契約操作や支払い UI が見えない方が分かりやすい。

もし paid entitlements の反映が不安定だと、彩は「招待されたのに使えない」「昨日まで見えていた定期スケジュールが今日は見えない」といった混乱を経験する。この journey は、 billing state が staff-facing entitlements に正しく反映されること、かつ契約責任と業務利用責任が分離されることを要求する。

### Journey 4: Internal Support / Operations - Troubleshooting Journey

鈴木遥は、このサービスのサポート担当者である。ある日、owner から「支払い方法を登録したのに有料機能が使えない」「trial 終了メールが来なかった」「 organization の状態が想定と違う」と問い合わせが入る。

遥は、対象 organization の billing 状態、trial の終了予定、 reminder email の送信履歴、Stripe 側の subscription 状態、アプリケーション側の organization billing 状態を確認できる必要がある。ここで情報が分断されていると、遥は原因を特定できず、対応が属人的になる。

理想的には、遥は「Stripe では trialing、アプリ側でも trialing、3日前メール送信済み」「あるいは Stripe は active だがアプリ側が未反映」といった差分をすぐ把握できる。必要であれば再同期や再送の判断材料が得られる。サポートが成功するとは、問い合わせが短時間で原因分類され、ユーザーへの説明が一貫し、手動復旧の負荷が限定されることである。

この journey は、運用管理画面、監査ログ、送信ログ、状態差分の可視化を要求する。

### Journey 5: Billing Integration / Stripe Operational Flow

この journey は end user ではなく、システム運用上の統合フローである。owner が trial を開始した瞬間から、アプリケーション側の organization billing 状態と Stripe subscription 状態は、一貫して同期している必要がある。

trial 開始時には organization が trial 状態になり、 trial 終了 3 日前には `customer.subscription.trial_will_end` を受けて reminder email を送る。owner が支払い方法を登録していれば、 trial 終了後に subscription は paid へ遷移し、 organization の entitlement も対応して切り替わる。逆に webhook の重複受信、順不同受信、一時的な配信失敗が起きても、最終状態が壊れてはならない。

この flow のクライマックスは、Stripe と organization billing の状態がズレず、 paid 機能の解放・停止が誤判定されないことにある。失敗すれば、無料組織に有料機能が開きっぱなしになるか、支払い済み組織の有料機能が止まる。どちらも致命的である。

この journey は、 webhook の冪等性、状態同期ロジック、監査可能性、再同期手段を要求する。

### Journey Requirements Summary

これらの journeys から、少なくとも次の capability 群が必要である。

- organization 単位の free / trial / paid 状態管理
- 無料機能と有料機能の差分を明確に示す UI
- owner 向け trial 開始導線
- payment method 登録導線
- trial 終了前の reminder email 送信
- trial 終了時の entitlement 切替
- staff には業務機能だけを適切に見せ、 billing 管理責任は owner に閉じる権限制御
- support/ops 向けの billing 状態、送信履歴、Stripe 差分の可視化
- Stripe webhook の冪等処理、順不同耐性、状態再同期手段
- downgrade / conversion 時に何が維持・停止されるかを明確にする UX

## Domain-Specific Requirements

### Compliance & Regulatory

- MVP 時点では特別な業界規制対応は前提としない。
- ただし、課金導線、trial 開始、payment method 登録、reminder email、paid 移行に関するデータ取り扱いは、既存のプライバシーポリシーと整合している必要がある。
- 課金状態の変更履歴、trial から paid への遷移、owner に対する通知送信履歴は、後から確認できる形で保持する。
- billing 関連の重要イベントは監査ログとして追跡可能にする。

### Technical Constraints

- MVP の請求・支払い管理は Stripe-hosted billing を前提とし、独自の請求書/領収書機能は持たない。
- billing authority は当面 `owner-only` をハードルールとし、staff や他ロールには契約変更・支払い操作を許可しない。
- organization 単位課金のため、billing 状態と entitlement は classroom 単位ではなく organization 単位で一貫して管理されなければならない。
- trial / paid 状態の切替時には、無料機能と有料機能の境界が UI と権限制御の両方で一致している必要がある。
- 通知チャネルは MVP ではメールのみとし、in-app 通知は前提にしない。

### Integration Requirements

- Stripe との統合では、subscription 状態、trial 終了予定、payment method 登録状態、paid 移行結果を organization billing 状態へ正しく反映する必要がある。
- `customer.subscription.trial_will_end` を受けて、trial 終了 3 日前に owner 向け reminder email を送信する。
- Stripe-hosted billing 画面とアプリケーション側の organization 状態表示が矛盾しないことを前提にする。
- 将来の独自請求書/領収書対応を妨げないよう、billing 履歴の保持粒度は最低限の拡張可能性を持たせる。

### Risk Mitigations

- owner-only billing authority を明示することで、現場 staff が誤って契約状態を変更するリスクを防ぐ。
- Stripe と organization billing state の差分を監査・再確認できるようにし、不整合の長期放置を防ぐ。
- reminder email を MVP の唯一の通知チャネルとして定義することで、通知責務を単純化し、運用漏れを減らす。
- 独自請求書/領収書を MVP から外すことで、初期実装の複雑性を抑え、課金導線と entitlement 制御の正確性に集中する。

## SaaS B2B Specific Requirements

### Project-Type Overview

本機能は、lesson / classroom 型事業者向け予約管理 SaaS における組織単位課金を対象とする。MVP では、各 `organization` は最大 1 つの subscription を持ち、`classroom` 数に関わらず billing の正本は organization 単位で管理する。課金状態は `free`、`premium trial`、`premium paid` の 3 状態を基本とし、初期リリースでは複数 paid tier を持たない。

### Technical Architecture Considerations

課金と entitlement は multi-classroom 構造の上に載るが、subscription の判定単位は常に organization である必要がある。これにより、ある classroom ごとに異なる契約状態を持つ設計は MVP では採用しない。organization billing state が変化したとき、その配下の classroom と staff に対する有料機能の解放状態が一貫して反映される必要がある。

権限モデルでは、billing authority は `owner-only` とし、`admin` を含む他ロールには plan 変更、payment method 管理、契約操作を許可しない。これは既存の org/classroom 権限モデルに追加される「契約責任の分離」であり、予約運用や参加者管理の権限と混線してはならない。

### Tenant Model

- subscription の単位は `organization`
- MVP では 1 organization = 最大 1 subscription
- `classroom` 数や拠点数は paid entitlement の対象であり、subscription の所有単位ではない
- 将来の複数 paid tier 対応を阻害しないように、plan state は拡張可能な構造で保持する

### RBAC Matrix

- `owner`: trial 開始、payment method 登録、plan 状態確認、paid 移行、将来の upgrade/downgrade の主体
- `admin`: 組織運営権限は持つが、billing 操作は不可
- `manager` / `staff`: billing 操作不可。有料機能が解放された結果のみ利用する
- `participant`: billing 文脈とは無関係

### Subscription Tier Model

MVP のプラン状態は次の 3 つに限定する。

- `free`
- `premium trial`
- `premium paid`

無料プランは永続利用可能であり、trial は paid 機能を期間限定で体験するための状態とする。trial 終了後、payment method が登録されていれば `premium paid` へ移行する。複数 paid tier は将来検討とし、MVP では扱わない。

### Integration Requirements

- billing integration は Stripe のみ
- 通知 integration は email delivery のみ
- `customer.subscription.trial_will_end` を利用して owner に trial 終了 3 日前の reminder を送る
- Stripe-hosted billing 画面とアプリケーション内の organization billing state が一致すること
- 将来の請求書/領収書や in-app 通知拡張を妨げないよう、状態・履歴の保持は拡張可能にする

### Compliance & Enterprise Considerations

MVP では重い enterprise compliance は対象外とする。ただし、B2B SaaS として次は必須である。

- プライバシーポリシー整合
- billing history の保持
- subscription / entitlement / notification に関する監査ログ
- owner が契約状態を説明可能で、support が追跡可能な運用透明性

### Implementation Considerations

この project type では、「支払いできること」だけでなく、「どの tenant にどの entitlements が開いているか」が本質となる。そのため、Stripe 状態の取り込み、organization billing state の正本管理、owner-only 権限制御、trial から paid への移行導線は、一つの一貫した業務フローとして設計しなければならない。

また、無料プランを永続提供する以上、free と paid の境界は契約面だけでなく、機能制御・表示・説明責任の面でも明確である必要がある。MVP では複雑な tier 設計や複数決済チャネルを避け、organization 単位課金と entitlement 制御の正確性を最優先とする。

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Revenue MVP

この MVP の目的は、owner/operator が有料機能の価値を理解し、7 日間トライアルを経て、支払い方法登録から paid への継続移行までをサポートなしで完了できることを実証することである。  
したがって、MVP では「課金業務全体を網羅すること」ではなく、「trial-to-paid の収益化ループを正しく回すこと」を最優先にする。

**Resource Requirements:**  
MVP は billing / entitlement / notification / webhook 同期をまたぐため、少なくとも backend、web、運用確認を横断して実装・検証できる体制が必要である。特に Stripe 状態と organization billing state の整合性検証が中核になる。

### MVP Feature Set (Phase 1)

**Core User Journeys Supported:**
- owner が free から premium trial を開始する
- owner が trial 中に有料機能の価値を理解する
- owner が trial 終了前に payment method を登録する
- reminder email を受け取る
- payment method 未登録時は free に戻る
- payment method 登録済みなら paid に中断なく移行する

**Must-Have Capabilities:**
- organization 単位の `free / premium trial / premium paid` billing state 管理
- 有料機能の entitlement gating
- 7 日間 trial 開始導線
- payment method 登録導線
- `customer.subscription.trial_will_end` を利用した 3 日前 reminder email
- Stripe webhook sync
- owner 向け billing status page
- trial 終了時、payment method 未登録 organization を自動で free へ戻す処理

### Post-MVP Features

**Phase 2 (Post-MVP):**
- support 向け billing 状態確認 UI の拡充
- audit log UI
- 詳細な billing history UI
- より豊かな free / paid 比較 UI
- self-serve の plan change / upgrade / downgrade 導線
- より強い internal visibility と運用補助

**Phase 3 (Expansion):**
- 複数 paid tier
- より高度な契約管理
- 独自請求書 / 領収書対応
- in-app billing 通知
- billing / analytics / contract を統合した運営管理基盤

### Risk Mitigation Strategy

**Technical Risks:**  
最大の技術リスクは、Stripe の subscription 状態と organization billing state の不整合、および entitlement 切替の誤判定である。MVP ではこの同期精度を最優先とし、周辺機能は絞る。

**Market Risks:**  
最大の市場リスクは、「owner が premium の価値を理解しても payment method 登録まで進まない」ことである。MVP は無料/有料差分の明確化、trial 体験、3 日前 reminder に集中してこの仮説を検証する。

**Resource Risks:**  
support tooling、audit log UI、詳細 billing history、self-serve plan change を MVP から外すことで、初期リソースを revenue loop の成立に集中させる。必要な内部確認は最小限の internal visibility で補う。

## Functional Requirements

### Plan & Eligibility Management

- FR1: owner can view the organization's current plan state as `free`, `premium trial`, or `premium paid`
- FR2: owner can see which capabilities are available in the free plan and which require premium
- FR3: the system can determine premium feature eligibility at the organization level
- FR4: the system can apply premium eligibility consistently across all classrooms belonging to the same organization
- FR5: staff can use premium-enabled operational capabilities only when their organization has active premium eligibility
- FR6: the system can return an organization to free eligibility when a premium trial ends without a valid payment method

### Trial Lifecycle

- FR7: owner can start a 7-day premium trial for their organization
- FR8: the system can prevent multiple overlapping premium trials for the same organization
- FR9: owner can see when the current trial will end
- FR10: the system can transition an organization from `premium trial` to `premium paid` when trial completion conditions are met
- FR11: the system can transition an organization from `premium trial` back to `free` when trial completion conditions are not met
- FR12: the system can preserve organization data and existing operational setup when plan state changes between free, trial, and paid

### Billing Authority & Access Control

- FR13: only the organization owner can initiate or manage subscription billing actions
- FR14: organization admins cannot change plan state or payment settings
- FR15: staff and classroom managers cannot access subscription billing controls
- FR16: the system can separate billing authority from operational management authority
- FR17: owner can access a billing status view without exposing billing controls to non-owner roles

### Payment Method & Paid Conversion

- FR18: owner can register a payment method for the organization before trial end
- FR19: owner can complete payment method registration without leaving ambiguity about whether premium will continue
- FR20: the system can continue premium access without interruption when a valid payment method exists at trial end
- FR21: the system can reflect whether payment method registration has been completed for the organization
- FR22: the system can prevent paid conversion when required billing conditions are not satisfied

### Notifications & Billing Communication

- FR23: the system can notify the owner by email that premium trial end is approaching
- FR24: the system can send the owner a reminder 3 days before trial end
- FR25: the reminder communication can direct the owner to complete payment method registration
- FR26: the system can communicate the consequence of taking no billing action before trial end
- FR27: the system can retain a history of billing-related owner notifications

### Billing State Synchronization & Reliability

- FR28: the system can synchronize organization billing state with Stripe subscription state
- FR29: the system can process premium trial lifecycle events received from Stripe
- FR30: the system can avoid creating conflicting organization billing states when duplicate billing events are received
- FR31: the system can recover to a correct organization billing state when billing events arrive out of order
- FR32: the system can identify when Stripe state and organization billing state do not match
- FR33: the system can maintain an auditable history of billing state changes and entitlement changes

### Support & Internal Operations

- FR34: authorized internal operators can inspect the billing state of an organization
- FR35: authorized internal operators can inspect whether reminder communication was sent
- FR36: authorized internal operators can inspect differences between Stripe billing state and application billing state
- FR37: authorized internal operators can use billing history and audit records to investigate billing-related issues

### Premium Capability Gating

- FR38: the system can gate multiple classroom and multiple site management behind premium eligibility
- FR39: the system can gate staff invitation and role management behind premium eligibility
- FR40: the system can gate recurring schedule operations behind premium eligibility
- FR41: the system can gate approval-based booking flows behind premium eligibility
- FR42: the system can gate ticket and recurring payment related capabilities behind premium eligibility
- FR43: the system can gate advanced contract management, participant invitation operations, CSV export, analytics, audit-oriented views, and priority support behind premium eligibility

### Post-MVP Billing Management Extensions

- FR44: owner can review billing history for the organization
- FR45: owner can change subscription plan after initial paid activation
- FR46: owner can upgrade or downgrade the organization's paid plan when multiple paid tiers are introduced
- FR47: the system can support multiple paid tiers in a future phase without changing the organization-scoped billing model
- FR48: the system can support additional billing communications beyond email in future phases
- FR49: the system can support invoice and receipt related capabilities in future phases

## Non-Functional Requirements

### Performance

- Billing status page must load within 3 seconds under normal usage conditions.
- Trial start and payment method registration handoff must feel immediate to the owner, without ambiguous waiting states.
- Entitlement changes triggered by Stripe events should be reflected within a few minutes, with a target of within 1 minute under normal conditions.

### Security

- Billing state changes must be restricted to the organization owner.
- Billing-related data must be protected in transit and at rest.
- Stripe webhook authenticity must be verified before billing state changes are applied.
- Billing state changes must be recorded in an auditable trail.
- Payment details must remain with the payment provider and must not be stored directly by the application except for the minimum provider-derived state needed for billing management.

### Reliability

- Reminder emails must retry on failure and must not fail silently.
- Duplicate or out-of-order Stripe webhook events must not corrupt organization billing state.
- If Stripe is temporarily unavailable, the system must recover safely and support resynchronization to a correct billing state.
- Plan state and entitlement state must remain internally consistent even when external event delivery is delayed or retried.

### Accessibility

- Billing and billing-status flows must meet a basic WCAG-minded accessibility standard for web use.
- Core billing actions and status information must be understandable and operable without relying solely on color or ambiguous visual cues.

### Integration

- Stripe is the single billing provider for MVP and must be treated as the source of truth for subscription lifecycle events.
- Email delivery is the only reminder channel for MVP and must be reliable enough to support trial conversion.
- The application must keep organization billing state and Stripe subscription state reconcilable at all times.

### Scalability

- MVP must support normal growth in organization count without requiring redesign of the billing model.
- The billing model must preserve the organization-scoped subscription approach as usage grows, even if classroom count increases.
- No hard enterprise-scale target is required for MVP, but the design must not block future tier expansion or larger organization adoption.
