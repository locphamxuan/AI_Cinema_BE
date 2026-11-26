-- MF-5: from a risky-transaction flag the Admin now locks the member's account (or dismisses the flag). The flag
-- keeps who acted, when and the note in its existing review columns. CONFIRMED stays for flags reviewed before.
ALTER TYPE "TransactionFlagStatus" ADD VALUE IF NOT EXISTS 'ACCOUNT_LOCKED';
