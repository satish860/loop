"""
Generate synthetic PDF test fixtures for EPIC 2.
Run: python scripts/create_pdf_fixtures.py
"""
import os

try:
    from fpdf import FPDF
except ImportError:
    print("Installing fpdf2...")
    os.system("pip install fpdf2")
    from fpdf import FPDF

DIR = os.path.join(os.path.dirname(__file__), "..", "fixtures")
os.makedirs(DIR, exist_ok=True)


def create_sample_lease():
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)

    # Page 1 — Title + Parties
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 15, "AIRCRAFT OPERATING LEASE AGREEMENT", ln=True, align="C")
    pdf.ln(10)
    pdf.set_font("Helvetica", "", 12)
    pdf.multi_cell(0, 7, (
        "This Aircraft Operating Lease Agreement (the \"Agreement\") is entered into "
        "as of March 15, 2021 (the \"Effective Date\")\n\n"
        "Between:\n\n"
        "AerCap Ireland Capital DAC\n"
        "a company incorporated in Ireland\n"
        "(hereinafter referred to as the \"Lessor\")\n\n"
        "And:\n\n"
        "Emirates Airlines\n"
        "a company incorporated in the United Arab Emirates\n"
        "(hereinafter referred to as the \"Lessee\")\n\n"
        "AIRCRAFT DETAILS:\n"
        "Manufacturer Serial Number (MSN): 4521\n"
        "Aircraft Type: Boeing B777-300ER\n"
        "Registration: A6-EGO\n"
        "Engines: 2x GE90-115B\n\n"
        "RECITALS:\n\n"
        "WHEREAS, the Lessor is the owner of the Aircraft described herein; and\n\n"
        "WHEREAS, the Lessee desires to lease the Aircraft from the Lessor on the "
        "terms and conditions set forth in this Agreement;\n\n"
        "NOW, THEREFORE, in consideration of the mutual covenants and agreements "
        "contained herein, the parties agree as follows:"
    ))

    # Page 2 — Key Terms
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "ARTICLE 1 - DEFINITIONS AND KEY TERMS", ln=True)
    pdf.ln(5)
    pdf.set_font("Helvetica", "", 12)
    pdf.multi_cell(0, 7, (
        "1.1 Definitions\n\n"
        "\"Aircraft\" means the Boeing B777-300ER aircraft bearing Manufacturer "
        "Serial Number (MSN) 4521, together with the Engines.\n\n"
        "\"Delivery Date\" means March 15, 2021.\n\n"
        "\"Lease Term\" means the period of twelve (12) years commencing on the "
        "Delivery Date and expiring on March 14, 2033.\n\n"
        "\"Monthly Rent\" means USD $385,000 (Three Hundred Eighty-Five Thousand "
        "United States Dollars) per calendar month.\n\n"
        "\"Security Deposit\" means USD $1,155,000 (equivalent to three months' rent).\n\n"
        "1.2 Maintenance Reserves\n\n"
        "The Lessee shall pay the following maintenance reserve contributions:\n\n"
        "  (a) Engine Reserves: USD $350 per Flight Hour ($/FH)\n"
        "  (b) Airframe Reserves: USD $180 per Flight Hour ($/FH)\n"
        "  (c) APU Reserves: USD $95 per Flight Hour ($/FH)\n"
        "  (d) Landing Gear Reserves: USD $45 per Cycle ($/CY)\n\n"
        "Total maintenance reserve rate: USD $670 per Flight Hour plus USD $45 per Cycle.\n\n"
        "1.3 Delivery Conditions\n\n"
        "The Aircraft shall be delivered at Dubai International Airport (DXB) "
        "in the condition specified in the Delivery Conditions Protocol attached "
        "as Schedule 2."
    ))

    # Page 3 — Return Conditions
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "ARTICLE 2 - RETURN CONDITIONS", ln=True)
    pdf.ln(5)
    pdf.set_font("Helvetica", "", 12)
    pdf.multi_cell(0, 7, (
        "2.1 Return of Aircraft\n\n"
        "Upon expiration or earlier termination of this Agreement, the Lessee shall "
        "return the Aircraft to the Lessor at a location designated by the Lessor "
        "in the following condition:\n\n"
        "  (a) The Aircraft shall be in a condition for immediate return to service "
        "with a reputable airline.\n\n"
        "  (b) All life-limited parts shall have no less than 50% of their certified "
        "life remaining.\n\n"
        "  (c) The most recent C-Check shall have been performed within the preceding "
        "24 months.\n\n"
        "  (d) Both engines shall have no less than 3,000 Flight Hours remaining "
        "until the next shop visit.\n\n"
        "  (e) The APU shall have no less than 2,000 hours remaining until next "
        "scheduled overhaul.\n\n"
        "  (f) The landing gear shall have been overhauled within the preceding "
        "10 years.\n\n"
        "2.2 Redelivery Location\n\n"
        "The Aircraft shall be redelivered at a maintenance facility approved by "
        "the Lessor, at the Lessee's expense.\n\n"
        "2.3 Redelivery Inspection\n\n"
        "The Lessor shall have the right to inspect the Aircraft and all records "
        "for a period of 60 days prior to the scheduled return date.\n\n"
        "IN WITNESS WHEREOF, the parties have executed this Agreement as of the "
        "date first written above.\n\n"
        "For AerCap Ireland Capital DAC:\n"
        "Name: John Murphy\n"
        "Title: Managing Director\n\n"
        "For Emirates Airlines:\n"
        "Name: Ahmed Al Maktoum\n"
        "Title: VP Fleet Management"
    ))

    path = os.path.join(DIR, "sample_lease.pdf")
    pdf.output(path)
    print(f"  sample_lease.pdf (3 pages)")


def create_sample_amendment():
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)

    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 12, "AMENDMENT NO. 1", ln=True, align="C")
    pdf.cell(0, 10, "TO AIRCRAFT OPERATING LEASE AGREEMENT", ln=True, align="C")
    pdf.ln(8)
    pdf.set_font("Helvetica", "", 12)
    pdf.multi_cell(0, 7, (
        "This Amendment No. 1 (the \"Amendment\") dated September 1, 2024, is made to "
        "the Aircraft Operating Lease Agreement dated March 15, 2021 (the \"Original Agreement\") "
        "between AerCap Ireland Capital DAC (\"Lessor\") and Emirates Airlines (\"Lessee\") "
        "relating to the aircraft bearing MSN 4521 (Boeing B777-300ER).\n\n"
        "WHEREAS, the parties wish to amend the maintenance reserve rates set forth in "
        "Section 1.2 of the Original Agreement;\n\n"
        "NOW, THEREFORE, the parties agree as follows:\n\n"
        "1. AMENDMENT TO MAINTENANCE RESERVES\n\n"
        "Section 1.2 of the Original Agreement is hereby amended and restated in its "
        "entirety as follows:\n\n"
        "The Lessee shall pay the following revised maintenance reserve contributions, "
        "effective from October 1, 2024:\n\n"
        "  (a) Engine Reserves: USD $420 per Flight Hour ($/FH)\n"
        "      [Increased from USD $350/FH per the Original Agreement]\n\n"
        "  (b) Airframe Reserves: USD $210 per Flight Hour ($/FH)\n"
        "      [Increased from USD $180/FH per the Original Agreement]\n\n"
        "  (c) APU Reserves: USD $110 per Flight Hour ($/FH)\n"
        "      [Increased from USD $95/FH per the Original Agreement]\n\n"
        "  (d) Landing Gear Reserves: USD $55 per Cycle ($/CY)\n"
        "      [Increased from USD $45/CY per the Original Agreement]\n\n"
        "The revised total maintenance reserve rate is USD $740 per Flight Hour "
        "plus USD $55 per Cycle.\n\n"
        "2. NO OTHER CHANGES\n\n"
        "Except as specifically amended hereby, all terms and conditions of the "
        "Original Agreement remain in full force and effect.\n\n"
        "3. EFFECTIVE DATE\n\n"
        "This Amendment shall be effective as of October 1, 2024.\n\n"
        "IN WITNESS WHEREOF:\n\n"
        "For AerCap Ireland Capital DAC:\n"
        "Name: John Murphy, Managing Director\n"
        "Date: September 1, 2024\n\n"
        "For Emirates Airlines:\n"
        "Name: Ahmed Al Maktoum, VP Fleet Management\n"
        "Date: September 1, 2024"
    ))

    path = os.path.join(DIR, "sample_amendment.pdf")
    pdf.output(path)
    print(f"  sample_amendment.pdf (1 page)")


if __name__ == "__main__":
    print("Creating PDF fixtures:")
    create_sample_lease()
    create_sample_amendment()
    print("\nDone!")
