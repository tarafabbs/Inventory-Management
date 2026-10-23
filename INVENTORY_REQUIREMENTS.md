# Saree Inventory and Barcode Management System — Requirements

## 1. Purpose

Build a system that tracks every saree individually from receipt through processing, handoff to an artisan, return, and final inventory. Every physical saree must have its own scannable barcode so that its source and movement history can be found at any time.

## 2. Inventory sources

The system must support both:

1. **Own stock:** sarees purchased or produced for the business's own company.
2. **External-company stock:** sarees received from another company for work in the business's factory.

Each saree must retain its source company and ownership category throughout its lifecycle. Sarees from different companies may be processed by the same artisan at the same time without combining their records.

## 3. Product, lot, and piece records

- **Product type:** Record attributes such as fabric or material (for example, silk or tussar) and any other useful classification.
- **Source company:** Record the company that supplied or owns the saree.
- **Lot:** Record each separate receipt or purchase, including its source company, receipt date, and received quantity. A later receipt of the same product from the same company is a new lot.
- **Piece:** Create one permanent record for each physical saree. Link it to its source company, ownership category, product type, and original lot.

The product type and company may be shared by many sarees. The **piece ID must be unique for every saree**, including sarees of the same type within the same lot.

## 4. Barcode generation and labels

- After the incoming goods are checked, generate and print one barcode label per accepted saree. For a receipt of 100 accepted sarees, generate 100 distinct piece IDs and 100 matching labels.
- The proposed readable ID format is a company prefix based on the first and last letters of the company name, followed by a running number. Example: `AE-000001`.
- Company names can produce the same two-letter prefix. The system must detect collisions and assign a distinct, fixed prefix to each company before generating IDs. A company's assigned prefix must not change when its display name is edited.
- A sequence number must never be reused for the same prefix. Piece IDs must remain unique across all lots and all companies.
- The barcode should encode the piece ID. The label should also print the ID in readable text so a damaged barcode can be entered manually.
- A piece's ID remains the same when it moves to an artisan, returns, is reworked, or changes status. Its company and lot are retrieved from its record after scanning.
- Labels must remain attached and readable throughout the work process. A damaged label can be reprinted with the **same** piece ID after the piece is verified.

## 5. Receiving and registration

1. Select whether the receipt is own stock or external-company stock.
2. Select the source company and enter the product details and lot information.
3. Check the received goods and record accepted, damaged, or rejected quantities.
4. Generate a unique piece record and label for every accepted saree.
5. Attach each label and scan it to confirm that the physical piece has been registered.
6. Add confirmed pieces to available in-house inventory.

The system must show discrepancies between the stated receipt quantity and the number of pieces actually registered.

## 6. Sending sarees to artisans

1. Select the artisan and start a handoff record.
2. Scan each saree individually. The system adds each valid scan to the handoff list and shows a running count.
3. Before confirmation, review the scanned pieces and count.
4. Confirm the handoff. The system records the date and time, operator, artisan, piece IDs, source companies, lots, and total count.
5. Each confirmed piece changes from available in-house inventory to **with artisan**.

One handoff may contain pieces from multiple companies, product types, or lots. The system must retain each piece's original details. It must reject duplicate scans and warn if a piece is not currently available to hand over.

## 7. Receiving completed or partially completed work

1. Select the artisan and start a return record.
2. Scan each returned saree individually. The system identifies its source company and lot automatically from its piece ID.
3. Check each returned piece and record the result, such as accepted, needs rework, or damaged.
4. Confirm the return. The system records the date and time, operator, artisan, scanned piece IDs, inspection results, and total count.
5. Accepted pieces return to the appropriate in-house inventory state. Pieces needing rework or marked damaged retain their own status and history.

Partial returns are allowed. Only the scanned pieces are returned; all other issued pieces remain assigned to the artisan. The system must warn if a piece being returned is not currently assigned to that artisan.

## 8. Balances and traceability

The system must calculate balances from confirmed piece movements, rather than from manually edited totals. It must show:

- Total pieces received, available in-house, with artisans, returned, needing rework, damaged, or otherwise accounted for.
- The exact pieces currently with each artisan, grouped by source company, product type, and lot.
- The number of pieces issued to and returned by each artisan.
- The complete history of each piece: receipt, registration, every handoff, every return, inspection outcome, and current holder/status.
- Lot-level and company-level balances, while still allowing a drill-down to individual piece IDs.

**Example:** Lot 1 contains 100 pieces. Fifty are scanned out to Artisan A and fifty to Artisan B. If A returns 20 scanned pieces, A still holds the other 30. If 30 pieces from Lot 2 are later scanned out to A, A holds 60 pieces in total: 30 from Lot 1 and 30 from Lot 2. Each returned piece is credited to its own lot automatically.

## 9. Controls and corrections

- A barcode scan must identify exactly one registered piece.
- A piece cannot be simultaneously available in-house and with an artisan.
- The system must block accidental duplicate scans within a transaction and invalid status changes.
- Corrections should be recorded as auditable reversals or adjustments, with a reason, operator, and timestamp; confirmed movement history should remain visible.
- If a label is lost, staff must verify the physical piece before reprinting its existing ID or recording an exception.
- The system should support physical stock checks and show any mismatch against recorded inventory.

## 10. Core screens

1. Company and product setup.
2. Receive goods, inspect, generate IDs, and print labels.
3. Scan pieces out to an artisan.
4. Scan returned pieces and record inspection results.
5. Artisan balances and outstanding pieces.
6. Inventory by company, lot, product type, and status.
7. Piece lookup and movement history.
8. Stock check, corrections, and exception handling.

## 11. Decisions to confirm before implementation

- The exact label size, material, printer, and scanner model, based on how the labels will be attached and handled during work.
- Whether an external company's own barcode should also be stored alongside the internal unique piece ID.
- Which inspection statuses and downstream steps are needed after an artisan returns a piece (for example, rework, finishing, sale, or return to the external company).
- Which staff roles may receive stock, hand off pieces, confirm returns, reprint labels, and make corrections.

