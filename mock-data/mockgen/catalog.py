"""Spending categories, MCC codes, fictional brands, billers and price rounding.

All brand names below are invented for this generator. They were chosen to avoid well-known
trademarks but were NOT trademark-searched; replace via config `merchants.extra_brands` if needed.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

# Hours-of-day mixtures (local time): (start_hour, end_hour, weight)
HOURS = {
    "shop": [(8, 12, 3), (12, 15, 3), (15, 20, 4), (20, 22, 1)],
    "morning": [(6, 9, 5), (9, 12, 3), (12, 17, 1)],
    "cafe": [(7, 10, 4), (10, 12, 2), (12, 15, 3), (15, 18, 3)],
    "meal": [(11, 14, 4), (18, 22, 6)],
    "night": [(18, 21, 2), (21, 24, 5)],
    "anytime": [(7, 12, 2), (12, 18, 3), (18, 24, 4), (0, 2, 0.4)],
    "commute": [(6, 9, 5), (16, 19, 4), (10, 16, 1), (19, 23, 1)],
    "business": [(8, 12, 4), (12, 17, 4)],
    "batch": [(1, 6, 1)],
    "day": [(9, 19, 1)],
}

WD = {  # Mon..Sun multipliers
    "flat": [1, 1, 1, 1, 1, 1, 1],
    "groceries": [0.9, 0.9, 1.0, 1.0, 1.3, 1.6, 0.35],
    "bakery": [1, 1, 1, 1, 1.1, 1.6, 1.1],
    "cafe": [1.1, 1.1, 1.1, 1.1, 1.1, 0.9, 0.7],
    "restaurant": [0.6, 0.6, 0.8, 1.0, 1.8, 2.0, 1.2],
    "bar": [0.3, 0.4, 0.6, 1.1, 2.4, 2.6, 0.6],
    "fast_food": [0.9, 0.9, 1.0, 1.0, 1.2, 1.3, 0.9],
    "leisure": [0.6, 0.6, 0.8, 0.9, 1.5, 1.8, 1.3],
    "delivery": [0.8, 0.8, 0.9, 1.0, 1.4, 1.3, 1.4],
    "retail": [0.8, 0.8, 0.9, 1.0, 1.2, 1.8, 0.5],
    "commute": [1.2, 1.2, 1.2, 1.2, 1.1, 0.5, 0.4],
    "taxi": [0.7, 0.7, 0.8, 1.0, 1.6, 1.8, 0.9],
    "weekday": [1.2, 1.2, 1.2, 1.2, 1.1, 0.1, 0.05],
}

SEASON = {  # Jan..Dec multipliers
    "flat": [1] * 12,
    "retail": [0.85, 0.85, 0.95, 1, 1, 1, 1.05, 1, 1, 1, 1.25, 1.55],
    "leisure": [0.85, 0.85, 0.95, 1, 1.05, 1.15, 1.2, 1.15, 1, 1, 0.95, 1.3],
    "fuel": [0.9, 0.9, 0.95, 1, 1.05, 1.1, 1.2, 1.2, 1, 1, 0.95, 1.0],
    "pharmacy": [1.3, 1.25, 1.1, 1, 0.9, 0.85, 0.8, 0.8, 0.95, 1.05, 1.15, 1.2],
}


@dataclass(frozen=True)
class Category:
    key: str
    mcc: str
    label: str
    median: float       # EUR, price level 1.0
    sigma: float        # log-normal sigma
    rounding: str
    hours: str
    weekday: str = "flat"
    season: str = "flat"
    local: bool = False  # generate local, country-specific merchants
    brands: tuple[str, ...] = ()
    online: bool = False  # single merchant row, charged in account currency


CATEGORIES: dict[str, Category] = {c.key: c for c in [
    Category("groceries", "5411", "Grocery stores, supermarkets", 34, 0.62, "free", "shop", "groceries", "retail", True,
             ("Colmara", "Vendelo", "Orvika", "Lunetta Markt", "Kornhaven", "Bravissa")),
    Category("bakery", "5462", "Bakeries", 6.2, 0.45, "tenth", "morning", "bakery", "flat", True, ("Crustella", "Panetto")),
    Category("cafe", "5814", "Coffee shops", 4.3, 0.35, "tenth", "cafe", "cafe", "flat", True,
             ("Brewlane Coffee", "Kafeo", "Bean & Ember")),
    Category("fast_food", "5814", "Fast food restaurants", 11, 0.4, "charm", "meal", "fast_food", "flat", False,
             ("Burger Forge", "Noodle Nest", "Pita Porta", "Crispy Corner", "Bowlito")),
    Category("restaurant", "5812", "Restaurants", 44, 0.55, "tenth", "meal", "restaurant", "leisure", True,
             ("Pastaria Veloce",)),
    Category("bar", "5813", "Bars, pubs", 24, 0.6, "tenth", "night", "bar", "leisure", True),
    Category("fuel", "5541", "Service stations", 62, 0.3, "free", "day", "flat", "fuel", False,
             ("Petrova", "Kinetra", "Motorvia", "Voltis")),
    Category("public_transport", "4111", "Local commuter transport", 3.1, 0.35, "tenth", "commute", "commute", "flat",
             False, ("Tickora", "Ridepass", "Transito")),
    Category("taxi", "4121", "Taxis and ride-hailing", 16, 0.5, "free", "anytime", "taxi", "flat", False,
             ("Ridora", "Hopcab", "Zipto")),
    Category("pharmacy", "5912", "Drug stores, pharmacies", 14, 0.7, "charm", "shop", "retail", "pharmacy", True,
             ("Medora", "Salvia Pharma")),
    Category("clothing", "5651", "Family clothing stores", 49, 0.7, "charm", "shop", "retail", "retail", True,
             ("Norra Wear", "Maison Velle", "Ulvik Studio", "Tessuto", "Kaldera")),
    Category("electronics", "5732", "Electronics stores", 89, 1.0, "charm", "shop", "retail", "retail", False,
             ("Voltara", "Pixelhaus", "Ohmstore", "Bytebox")),
    Category("home_diy", "5200", "Home supply, DIY", 34, 0.8, "charm", "shop", "retail", "retail", False,
             ("Hammerhof", "Casa Forte", "Nestwise Home", "Bricovia")),
    Category("books", "5942", "Book stores", 17, 0.4, "charm", "shop", "retail", "retail", False,
             ("Leafline Books", "Paginas")),
    Category("marketplace", "5399", "Online marketplace", 29, 0.9, "charm", "anytime", "flat", "retail", False,
             ("Shopvana", "Parcelo", "Buyzzle", "Cartwheel"), True),
    Category("food_delivery", "5814", "Food delivery", 27, 0.35, "free", "meal", "delivery", "flat", False,
             ("Forkly", "Munchbox"), True),
    Category("cinema", "7832", "Cinemas", 13, 0.3, "half", "night", "leisure", "leisure", False, ("CineAstra", "Filmhalle")),
    Category("hotel", "7011", "Hotels", 110, 0.4, "whole", "day", "flat", "flat", True),
    Category("travel_booking", "4722", "Travel agencies, booking platforms", 300, 0.5, "whole", "anytime", "flat",
             "flat", False, ("Stayvia", "Roomora"), True),
    Category("airline", "4511", "Airlines", 140, 0.6, "charm", "anytime", "flat", "flat", False,
             ("Alvara Air", "Corvina Airlines", "Bluewing"), True),
    Category("hair_beauty", "7230", "Hair and beauty salons", 38, 0.4, "half", "day", "retail", "flat", True),
    Category("parking", "7523", "Parking", 4.5, 0.6, "tenth", "day", "flat", "flat", False, ("Parkora", "Spotly Parking")),
    Category("subscription", "5815", "Digital media subscriptions", 9.99, 0.0, "fixed", "batch", "flat", "flat", False,
             (), True),
    Category("software", "5734", "Software, SaaS", 15, 0.0, "fixed", "batch", "flat", "flat", False,
             ("Draftwell", "Quillbox", "Stackora"), True),
    Category("coworking", "7399", "Business services, coworking", 180, 0.3, "whole", "business", "weekday", "flat",
             False, ("Hubora Coworking", "Deskfield")),
    Category("office_supplies", "5943", "Office supplies", 35, 0.7, "charm", "business", "weekday", "flat", False,
             ("Paperloft", "Officina Supply")),
    Category("car_repair", "7538", "Auto service shops", 380, 0.6, "free", "business", "weekday", "flat", False,
             ("Gearwell Auto", "Motorpunkt Service")),
    Category("charity", "8398", "Charitable organisations", 20, 0.5, "five", "anytime", "flat", "retail", False,
             ("Hope Harbour Foundation", "Green Roots Fund"), True),
    Category("attractions", "7991", "Tourist attractions", 18, 0.5, "half", "day", "leisure", "leisure", False,
             ("Explora Tours", "Museo Pass")),
    Category("gaming", "5816", "Digital games", 19.99, 0.6, "charm", "anytime", "leisure", "retail", False,
             ("Pixelforge Games",), True),
]}

# Recurring digital subscriptions (EUR price; local prices derived and charm-rounded)
SUBSCRIPTIONS = [
    ("Streamora", 13.99), ("Cinevia+", 8.99), ("Tunewave", 10.99), ("Podora", 9.99), ("CloudNest", 2.99),
    ("PlayArena", 14.99), ("Lingora", 12.99), ("FitPulse", 7.99), ("Newsdeck", 9.99),
]
SAAS = [("Draftwell", 11.99), ("Quillbox", 9.00), ("Stackora", 24.00)]

BILLERS = {
    "electricity": ("Enerna", "Voltia", "Lumeno"),
    "telecom": ("Telvia", "Linkora", "Vexa Mobile"),
    "insurance": ("Aegida", "Solvara", "Ancora"),
    "gym": ("Motiva Fitness", "IronPulse"),
}
ACQUIRER = "Paynetra Merchant Services"

# Real public authorities (payers of pensions / recipients of taxes). Swap if undesired.
TAX_AUTHORITY = {"DE": "Finanzamt {c}", "AT": "Finanzamt Österreich", "FR": "DGFiP", "NL": "Belastingdienst",
                 "ES": "Agencia Tributaria", "IT": "Agenzia delle Entrate", "PL": "Urząd Skarbowy {c}",
                 "EE": "Maksu- ja Tolliamet", "LV": "Valsts ieņēmumu dienests", "LT": "VMI", "FI": "Verohallinto",
                 "IE": "Revenue Commissioners", "BE": "FOD Financiën", "PT": "Autoridade Tributária",
                 "SE": "Skatteverket", "CZ": "Finanční úřad {c}"}
PENSION_PAYER = {"DE": "Deutsche Rentenversicherung", "AT": "Pensionsversicherungsanstalt", "FR": "Assurance retraite",
                 "NL": "Sociale Verzekeringsbank", "ES": "INSS Seguridad Social", "IT": "INPS", "PL": "ZUS",
                 "EE": "Sotsiaalkindlustusamet", "LV": "VSAA", "LT": "Sodra", "FI": "Kela",
                 "IE": "Department of Social Protection", "BE": "Federale Pensioendienst",
                 "PT": "Centro Nacional de Pensões", "SE": "Pensionsmyndigheten", "CZ": "ČSSZ"}

# Real brands we must never emit (sanity check on generated names)
TRADEMARK_BLOCKLIST = {
    "lidl", "aldi", "rewe", "edeka", "carrefour", "tesco", "ikea", "zara", "h&m", "amazon", "netflix", "spotify",
    "uber", "bolt", "wolt", "glovo", "deliveroo", "mcdonald", "starbucks", "shell", "aral", "esso", "bp", "revolut",
    "n26", "klarna", "paypal", "apple", "google", "ryanair", "lufthansa", "airbnb", "booking.com", "zalando",
    "mediamarkt", "saturn", "decathlon", "primark", "biedronka", "zabka", "rimi", "maxima", "prisma", "mercadona",
    "esselunga", "albert heijn", "jumbo", "dm-drogerie", "rossmann", "kfc", "burger king", "subway", "allegro",
}


def round_price(eur_like: float, style: str, currency: str, rng) -> int:
    """Round an amount (already in `currency` units) to realistic price endings. Returns minor units."""
    x = max(eur_like, 0.01)
    whole_ccy = currency in ("SEK", "CZK")
    r = rng.random()
    if style == "fixed":
        v = x
    elif style == "free":
        v = round(x, 2) if not (whole_ccy and r < 0.5) else round(x)
    elif style == "tenth":
        v = round(x, 1) if not whole_ccy else round(x)
    elif style == "half":
        v = round(x * 2) / 2 if not whole_ccy else (round(x / 5) * 5 if x > 30 else round(x))
    elif style == "whole":
        v = round(x) if x < 100 else round(x / 5) * 5
    elif style == "five":
        step = 5 if x < 200 else 10
        if whole_ccy:
            step *= 10
        v = max(step, round(x / step) * step)
    elif style == "charm":
        if whole_ccy:
            if x < 20:
                v = round(x)
            else:
                v = (math.floor(x / 10) * 10) + 9 if r < 0.75 else round(x / 10) * 10
        elif x < 100:
            base = math.floor(x)
            end = 0.99 if r < 0.5 else 0.49 if r < 0.65 else 0.95 if r < 0.8 else 0.0
            v = base + end
        else:
            v = math.floor(x / 10) * 10 + (9.99 if r < 0.6 else 9.0 if r < 0.75 else 0.0)
    else:
        raise ValueError(style)
    return max(1, int(round(v * 100)))


def pick_hour(profile: str, rng) -> tuple[int, int, int]:
    parts = HOURS[profile]
    total = sum(p[2] for p in parts)
    x = rng.random() * total
    for h0, h1, w in parts:
        if x < w:
            break
        x -= w
    minute_of = rng.random() * (h1 - h0) * 60
    h = h0 + int(minute_of // 60)
    return h % 24, int(minute_of % 60), int(rng.integers(0, 60))
