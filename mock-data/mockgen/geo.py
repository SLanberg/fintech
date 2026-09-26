"""Per-country reference data: locales, currencies, price levels, cities, streets, phones.

Cities and street names are real, generic place names (not tied to persons). Postcode
patterns are approximations good enough for a demo: '#' = digit, '@' = Dutch postcode
letter, '?' = Eircode character.
"""
from __future__ import annotations

from dataclasses import dataclass, field

EIRCODE_CHARS = "ACDEFHKNPRTVWXY0123456789"
NL_POSTCODE_LETTERS = "ABCDEGHJKLMNPRSTVWXZ"


@dataclass(frozen=True)
class City:
    name: str
    weight: float
    postcode: str          # pattern
    lang: str | None = None  # override (Belgium)


@dataclass(frozen=True)
class Country:
    code: str
    locale: str
    lang: str
    currency: str
    tz: str
    price_level: float       # 1.0 = DE
    net_salary_eur: float    # median net monthly salary, EUR
    cash_use: float          # ATM withdrawals per month, typical salaried
    sunday_shops_closed: bool
    phone: tuple[str, ...]   # mobile number patterns
    cities: tuple[City, ...]
    streets: tuple[str, ...]
    address_fmt: str = "{street} {num}"
    alt_locale: dict[str, str] = field(default_factory=dict)  # lang -> faker locale


C = City
COUNTRIES: dict[str, Country] = {
    "DE": Country(
        "DE", "de_DE", "de", "EUR", "Europe/Berlin", 1.00, 2600, 2.5, True,
        ("+49 15# #######", "+49 16# #######", "+49 17# #######"),
        (C("Berlin", 3.7, "10###"), C("Hamburg", 1.9, "22###"), C("München", 1.5, "80###"),
         C("Köln", 1.1, "50###"), C("Frankfurt am Main", 0.8, "60###"), C("Stuttgart", 0.6, "70###"),
         C("Düsseldorf", 0.6, "40###"), C("Leipzig", 0.6, "04###"), C("Dresden", 0.55, "01###"),
         C("Nürnberg", 0.5, "90###"), C("Hannover", 0.5, "30###"), C("Bremen", 0.55, "28###")),
        ("Hauptstraße", "Bahnhofstraße", "Gartenstraße", "Schulstraße", "Dorfstraße", "Bergstraße",
         "Lindenstraße", "Kirchstraße", "Waldstraße", "Ringstraße", "Mühlenweg", "Birkenweg",
         "Goethestraße", "Schillerstraße", "Friedhofstraße", "Am Markt", "Parkstraße", "Rosenweg"),
    ),
    "FR": Country(
        "FR", "fr_FR", "fr", "EUR", "Europe/Paris", 0.98, 2300, 1.2, False,
        ("+33 6 ## ## ## ##", "+33 7 ## ## ## ##"),
        (C("Paris", 2.1, "7501#"), C("Marseille", 0.87, "1300#"), C("Lyon", 0.52, "6900#"),
         C("Toulouse", 0.5, "3100#"), C("Nice", 0.34, "06#00"), C("Nantes", 0.32, "44#00"),
         C("Strasbourg", 0.29, "67#00"), C("Montpellier", 0.3, "34#00"), C("Bordeaux", 0.26, "3300#"),
         C("Lille", 0.23, "5900#")),
        ("rue de la République", "rue Victor Hugo", "avenue Jean Jaurès", "rue Pasteur",
         "boulevard Gambetta", "rue du Général de Gaulle", "rue de la Gare", "place de l'Église",
         "rue des Écoles", "avenue de la Libération", "rue du Moulin", "impasse des Lilas",
         "rue Nationale", "allée des Tilleuls", "chemin des Vignes"),
        "{num} {street}",
    ),
    "NL": Country(
        "NL", "nl_NL", "nl", "EUR", "Europe/Amsterdam", 1.05, 2800, 0.6, False,
        ("+31 6 ########",),
        (C("Amsterdam", 0.92, "10## @@"), C("Rotterdam", 0.66, "30## @@"), C("Den Haag", 0.56, "25## @@"),
         C("Utrecht", 0.37, "35## @@"), C("Eindhoven", 0.24, "56## @@"), C("Groningen", 0.24, "97## @@"),
         C("Tilburg", 0.22, "50## @@"), C("Almere", 0.22, "13## @@")),
        ("Kerkstraat", "Dorpsstraat", "Stationsweg", "Molenstraat", "Schoolstraat", "Julianastraat",
         "Wilhelminastraat", "Beatrixstraat", "Nieuwstraat", "Marktstraat", "Kastanjelaan", "Eikenlaan",
         "Prinsengracht", "Singel", "Irenestraat"),
    ),
    "ES": Country(
        "ES", "es_ES", "es", "EUR", "Europe/Madrid", 0.86, 1750, 1.8, False,
        ("+34 6## ### ###", "+34 7## ### ###"),
        (C("Madrid", 3.3, "280##"), C("Barcelona", 1.6, "080##"), C("Valencia", 0.8, "460##"),
         C("Sevilla", 0.68, "410##"), C("Zaragoza", 0.67, "500##"), C("Málaga", 0.58, "290##"),
         C("Murcia", 0.46, "300##"), C("Bilbao", 0.35, "480##")),
        ("Calle Mayor", "Calle Real", "Avenida de la Constitución", "Calle Nueva", "Plaza de España",
         "Calle de la Iglesia", "Calle del Sol", "Avenida de Andalucía", "Calle San José",
         "Calle Cervantes", "Paseo de la Estación", "Calle Luna", "Calle Libertad"),
        "{street}, {num}",
    ),
    "IT": Country(
        "IT", "it_IT", "it", "EUR", "Europe/Rome", 0.92, 1750, 1.6, False,
        ("+39 3## ### ####",),
        (C("Roma", 2.8, "001##"), C("Milano", 1.4, "201##"), C("Napoli", 0.95, "801##"),
         C("Torino", 0.85, "101##"), C("Palermo", 0.63, "901##"), C("Genova", 0.56, "161##"),
         C("Bologna", 0.39, "401##"), C("Firenze", 0.36, "501##")),
        ("Via Roma", "Via Garibaldi", "Via Mazzini", "Via Dante Alighieri", "Corso Italia",
         "Via Cavour", "Via Verdi", "Piazza della Libertà", "Via Marconi", "Via XX Settembre",
         "Viale Europa", "Via Matteotti", "Via San Francesco"),
        "{street}, {num}",
    ),
    "PL": Country(
        "PL", "pl_PL", "pl", "PLN", "Europe/Warsaw", 0.58, 1300, 1.8, True,
        ("+48 5## ### ###", "+48 6## ### ###", "+48 7## ### ###", "+48 88# ### ###"),
        (C("Warszawa", 1.8, "0#-###"), C("Kraków", 0.8, "3#-###"), C("Wrocław", 0.67, "5#-###"),
         C("Łódź", 0.66, "9#-###"), C("Poznań", 0.54, "6#-###"), C("Gdańsk", 0.47, "80-###"),
         C("Szczecin", 0.39, "70-###"), C("Lublin", 0.33, "20-###")),
        ("ul. Polna", "ul. Leśna", "ul. Słoneczna", "ul. Krótka", "ul. Szkolna", "ul. Ogrodowa",
         "ul. Lipowa", "ul. Kwiatowa", "ul. Brzozowa", "ul. Mickiewicza", "ul. Kościuszki",
         "ul. Sienkiewicza", "ul. Kolejowa", "ul. Długa", "al. Jana Pawła II"),
    ),
    "EE": Country(
        "EE", "et_EE", "et", "EUR", "Europe/Tallinn", 0.78, 1550, 0.6, False,
        ("+372 5### ####", "+372 5## ####"),
        (C("Tallinn", 4.4, "1####"), C("Tartu", 0.97, "5####"), C("Narva", 0.54, "20###"),
         C("Pärnu", 0.51, "8####"), C("Kohtla-Järve", 0.33, "30###"), C("Viljandi", 0.17, "71###")),
        ("Pärnu mnt", "Narva mnt", "Tartu mnt", "Liivalaia tn", "Endla tn", "Kalevi tn", "Riia tn",
         "Männi tn", "Kase tn", "Pargi tn", "Kooli tn", "Aia tn", "Jõe tn", "Posti tn", "Vabaduse pst"),
    ),
    "LV": Country(
        "LV", "lv_LV", "lv", "EUR", "Europe/Riga", 0.68, 1150, 1.0, False,
        ("+371 2### ####",),
        (C("Rīga", 6.1, "LV-10##"), C("Daugavpils", 0.8, "LV-54##"), C("Liepāja", 0.67, "LV-34##"),
         C("Jelgava", 0.55, "LV-30##"), C("Jūrmala", 0.5, "LV-20##"), C("Ventspils", 0.33, "LV-36##")),
        ("Brīvības iela", "Elizabetes iela", "Krišjāņa Barona iela", "Lāčplēša iela", "Tērbatas iela",
         "Dzirnavu iela", "Skolas iela", "Meža iela", "Dārza iela", "Rīgas iela", "Pils iela",
         "Ganību dambis", "Stacijas iela"),
    ),
    "LT": Country(
        "LT", "lt_LT", "lt", "EUR", "Europe/Vilnius", 0.70, 1350, 1.0, False,
        ("+370 6## #####",),
        (C("Vilnius", 5.9, "LT-0####"), C("Kaunas", 2.9, "LT-4####"), C("Klaipėda", 1.5, "LT-9####"),
         C("Šiauliai", 1.0, "LT-7####"), C("Panevėžys", 0.87, "LT-3####")),
        ("Gedimino pr.", "Vilniaus g.", "Konstitucijos pr.", "Savanorių pr.", "Laisvės al.",
         "Taikos pr.", "Mokyklos g.", "Sodų g.", "Liepų g.", "Beržų g.", "Pušų g.", "Kalvarijų g.",
         "Žalgirio g."),
    ),
    "FI": Country(
        "FI", "fi_FI", "fi", "EUR", "Europe/Helsinki", 1.08, 2600, 0.4, False,
        ("+358 40 ### ####", "+358 50 ### ####", "+358 44 ### ####"),
        (C("Helsinki", 6.6, "00###"), C("Espoo", 3.0, "02###"), C("Tampere", 2.5, "33###"),
         C("Vantaa", 2.4, "01###"), C("Oulu", 2.1, "90###"), C("Turku", 2.0, "20###"),
         C("Jyväskylä", 1.5, "40###")),
        ("Mannerheimintie", "Hämeenkatu", "Kauppakatu", "Asemakatu", "Koulukatu", "Kirkkokatu",
         "Puistokatu", "Rantatie", "Koivukuja", "Männikkötie", "Myllytie", "Aleksanterinkatu",
         "Kalevankatu"),
    ),
    "IE": Country(
        "IE", "en_IE", "en", "EUR", "Europe/Dublin", 1.12, 2900, 1.0, False,
        ("+353 83 ### ####", "+353 85 ### ####", "+353 86 ### ####", "+353 87 ### ####"),
        (C("Dublin", 5.9, "D0# ????"), C("Cork", 2.2, "T12 ????"), C("Limerick", 0.95, "V94 ????"),
         C("Galway", 0.84, "H91 ????"), C("Waterford", 0.6, "X91 ????")),
        ("Main Street", "Church Road", "Station Road", "Castle Street", "Bridge Street", "Mill Lane",
         "Green Park", "Oak Avenue", "Seafield Road", "Abbey Street", "Harbour View", "Willow Grove"),
        "{num} {street}",
    ),
    "AT": Country(
        "AT", "de_AT", "de", "EUR", "Europe/Vienna", 1.00, 2500, 2.2, True,
        ("+43 66# #######", "+43 67# #######", "+43 68# #######"),
        (C("Wien", 1.95, "1##0"), C("Graz", 0.29, "80##"), C("Linz", 0.21, "40##"),
         C("Salzburg", 0.16, "50##"), C("Innsbruck", 0.13, "60##"), C("Klagenfurt", 0.1, "90##")),
        ("Hauptstraße", "Bahnhofstraße", "Kirchengasse", "Schulgasse", "Linzer Straße", "Grazer Straße",
         "Wiener Straße", "Lindengasse", "Mariahilfer Straße", "Feldgasse", "Mühlweg", "Rosengasse"),
    ),
    "BE": Country(
        "BE", "nl_BE", "nl", "EUR", "Europe/Brussels", 1.02, 2600, 0.9, False,
        ("+32 47# ## ## ##", "+32 48# ## ## ##", "+32 49# ## ## ##"),
        (C("Brussel", 0.9, "10##", "nl"), C("Bruxelles", 1.9, "10##", "fr"), C("Antwerpen", 1.1, "20##", "nl"),
         C("Gent", 0.55, "90##", "nl"), C("Charleroi", 0.4, "60##", "fr"), C("Liège", 0.39, "40##", "fr"),
         C("Brugge", 0.23, "80##", "nl"), C("Namur", 0.22, "50##", "fr"), C("Leuven", 0.2, "30##", "nl")),
        ("Kerkstraat", "Stationsstraat", "Dorpsstraat", "Molenstraat", "Nieuwstraat", "Schoolstraat",
         "Kapelstraat", "Beekstraat"),
        "{street} {num}",
        {"fr": "fr_BE", "nl": "nl_BE"},
    ),
    "PT": Country(
        "PT", "pt_PT", "pt", "EUR", "Europe/Lisbon", 0.74, 1150, 2.0, False,
        ("+351 91# ### ###", "+351 92# ### ###", "+351 93# ### ###", "+351 96# ### ###"),
        (C("Lisboa", 2.9, "1###-###"), C("Porto", 1.7, "4###-###"), C("Braga", 0.6, "47##-###"),
         C("Coimbra", 0.45, "30##-###"), C("Faro", 0.3, "80##-###"), C("Aveiro", 0.3, "38##-###")),
        ("Rua da Liberdade", "Avenida da República", "Rua Direita", "Rua do Comércio", "Rua 25 de Abril",
         "Rua da Igreja", "Largo do Rossio", "Avenida Central", "Rua de Santo António", "Travessa do Carmo",
         "Rua das Flores", "Rua Nova"),
        "{street}, {num}",
    ),
    "SE": Country(
        "SE", "sv_SE", "sv", "SEK", "Europe/Stockholm", 1.05, 2600, 0.2, False,
        ("+46 70 ### ## ##", "+46 72 ### ## ##", "+46 73 ### ## ##", "+46 76 ### ## ##"),
        (C("Stockholm", 2.4, "11# ##"), C("Göteborg", 1.0, "41# ##"), C("Malmö", 0.7, "21# ##"),
         C("Uppsala", 0.4, "75# ##"), C("Västerås", 0.3, "72# ##"), C("Örebro", 0.3, "70# ##"),
         C("Linköping", 0.3, "58# ##")),
        ("Storgatan", "Drottninggatan", "Kungsgatan", "Skolgatan", "Kyrkogatan", "Järnvägsgatan",
         "Parkvägen", "Björkvägen", "Ringvägen", "Tallvägen", "Nygatan", "Sjövägen", "Östra Långgatan"),
    ),
    "CZ": Country(
        "CZ", "cs_CZ", "cs", "CZK", "Europe/Prague", 0.68, 1300, 1.5, False,
        ("+420 60# ### ###", "+420 7## ### ###"),
        (C("Praha", 3.0, "1## ##"), C("Brno", 1.0, "6## ##"), C("Ostrava", 0.7, "70# ##"),
         C("Plzeň", 0.4, "30# ##"), C("Liberec", 0.3, "460 ##"), C("Olomouc", 0.3, "779 ##")),
        ("Nádražní", "Školní", "Husova", "Palackého", "Masarykova", "Komenského", "Jiráskova",
         "Nerudova", "Smetanova", "Lidická", "Tyršova", "Zahradní", "Revoluční"),
    ),
}

EUROZONE = {c for c, v in COUNTRIES.items() if v.currency == "EUR"}

# Popular holiday destinations (relative weights) for travel episodes
TRAVEL_WEIGHTS = {"ES": 5, "IT": 4.5, "FR": 3.5, "PT": 2.5, "AT": 2, "DE": 2, "NL": 1.5, "CZ": 1.5,
                  "IE": 1, "SE": 1, "FI": 0.6, "BE": 0.8, "PL": 1, "EE": 0.6, "LV": 0.5, "LT": 0.5}

# EUR -> X reference rates (approximate; a small seeded random walk is applied per day)
FX_BASE = {"EUR": 1.0, "PLN": 4.27, "SEK": 11.05, "CZK": 24.9}


def fill_pattern(pattern: str, rng) -> str:
    out = []
    for ch in pattern:
        if ch == "#":
            out.append(str(int(rng.integers(0, 10))))
        elif ch == "@":
            out.append(NL_POSTCODE_LETTERS[int(rng.integers(0, len(NL_POSTCODE_LETTERS)))])
        elif ch == "?":
            out.append(EIRCODE_CHARS[int(rng.integers(0, len(EIRCODE_CHARS)))])
        else:
            out.append(ch)
    return "".join(out)


def pick_city(country: Country, rng) -> City:
    w = [c.weight for c in country.cities]
    total = sum(w)
    return country.cities[int(rng.choice(len(w), p=[x / total for x in w]))]


def city_lang(country: Country, city: City) -> str:
    return city.lang or country.lang


def locale_for(country: Country, lang: str) -> str:
    return country.alt_locale.get(lang, country.locale)


FR_BE_STREETS = ("Rue de la Station", "Rue de l'Église", "Avenue Louise", "Rue du Moulin", "Chaussée de Namur",
                 "Rue Haute", "Place Communale", "Rue des Écoles", "Avenue des Tilleuls")


def make_address(country: Country, city: City, rng) -> str:
    lang = city_lang(country, city)
    streets = FR_BE_STREETS if (country.code == "BE" and lang == "fr") else country.streets
    street = streets[int(rng.integers(0, len(streets)))]
    num = int(rng.integers(1, 60)) if rng.random() < 0.7 else int(rng.integers(1, 220))
    num_s = str(num)
    if country.code in ("DE", "AT", "NL", "CZ") and rng.random() < 0.1:
        num_s += "abc"[int(rng.integers(0, 3))]
    if country.code in ("AT",) and rng.random() < 0.5:
        num_s += f"/{int(rng.integers(1, 25))}"  # Viennese door numbers
    if country.code == "ES" and rng.random() < 0.6:
        num_s += f", {int(rng.integers(1, 9))}º {'ABCD'[int(rng.integers(0, 4))]}"
    if country.code in ("PL", "LT", "LV", "EE", "CZ") and rng.random() < 0.6:
        num_s += f"-{int(rng.integers(1, 90))}"  # apartment number
    return country.address_fmt.format(street=street, num=num_s)


def make_phone(country: Country, rng) -> str:
    pattern = country.phone[int(rng.integers(0, len(country.phone)))]
    return fill_pattern(pattern, rng)
