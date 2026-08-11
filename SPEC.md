# Al-Mizaan Judge — productspecificatie stap 1

Dit document is zelfstandig leesbaar, ook zonder de rest van het gesprek waarin het ontstond. Doel:
een andere Claude-sessie kan dit lezen en precies begrijpen wat er gebouwd wordt en waarom.

## Wat het is, in één zin

Een tool waar een security-onderzoeker een eigen bug-bounty vermoeden (thesis + code) in plakt, en
binnen enkele minuten een streng, onderbouwd oordeel terugkrijgt over of die bevinding een echte
indiening bij een audit-contest (Sherlock, Immunefi, Cantina) zou overleven, en waarom wel of niet.

## Waarom dit specifiek, en waarom nu

We hebben in het wazir-al-ghanima-project (smart-contract bug-bounty jacht) een intern beoordelings-
raamwerk gebouwd, Al-Mizaan v3, dat elke eigen hypothese door 7 poorten haalt voor we hem indienen:
scope, bereikbaarheid, aanvaller-type, welk protocolprincipe breekt, of het bedoeld gedrag is, echte
dollarschade, en tot slot een drie-rollen-tegenspraak (een agent bewijst het, een andere probeert het
kapot te maken, een derde velt onafhankelijk oordeel). De score is vermenigvuldigend, niet optellend,
zodat één zwakke schakel de hele claim laat crashen in plaats van dat zwakke signalen zich opstapelen
tot een vals-positieve indiening. Dit raamwerk is ontwikkeld en aangescherpt door tientallen echte
audits, en heeft ons al talloze valse hypotheses laten elimineren voor we tijd/reputatie/inzet
verspilden aan een indiening die toch zou worden afgewezen. Eerlijkheidscorrectie (2026-08-11): "echte
Sherlock-uitspraken" hierboven suggereerde statistische kalibratie tegen een groot, representatief
corpus — dat bestaat nog niet. Het interne 3ilm-corpus waarop eerdere numerieke drempels leunden bleek
een niet-representatieve steekproef (10 contests, laag-uitbetalend); het volledige, representatieve
corpus (81 contests) wordt nog opgebouwd. De Sherlock-platformregels die dit product wél gebruikt
(SJIP-21, SJIP-26, dollar-drempels) zijn Sherlock's eigen gepubliceerde beleid, geen eigen statistiek.

Dat is precies het soort werk dat een extern team maanden kost om te bouwen én te valideren tegen de
praktijk. Wij hebben het al, inclusief de validatie. Het ontbrekende stuk is puur verpakking: zodat
een ANDER dit ook kan gebruiken voor zijn eigen hypotheses, niet alleen wijzelf.

## Voor wie

Onafhankelijke smart-contract security-onderzoekers / bug-bounty-jagers die een eigen vermoeden
hebben geschreven en, voor ze het indienen, een strenge tweede mening willen: overleeft dit de
poorten, of ben ik iets over het hoofd aan het zien dat een menselijke judge wel zou vinden.

## Input (wat de gebruiker aanlevert)

- De bevinding zelf: een beschrijving van het vermoedelijke probleem, in vrije tekst.
- De relevante code: het stukje/de bestanden waar het om gaat (geen hele repo, gericht).
- Optioneel: op welk platform hij wil indienen (Sherlock/Immunefi/Cantina/anders) — de platform-
  specifieke harde regels verschillen (bv. Sherlock's SJIP-21: generieke Chainlink-staleness is altijd
  ongeldig; SJIP-26: een trusted actor als enige aanvaller is ongeldig).
- Optioneel: relevante README/scope-tekst van het protocol (voor de scope-poort en de intent-check).

## Wat er intern gebeurt (hergebruik van bestaande logica)

Dezelfde keten als ons interne proces, in deze volgorde:
1. Scope-poort (staat het in scope, is het expliciet buiten scope verklaard, dekt een expliciete
   protocol-aanname het al)
2. Platform-hardcodes (Sherlock SJIP-regels als eerste ingebouwde set, uitbreidbaar naar andere
   platforms)
3. Bereikbaarheids-keten (kan dit pad daadwerkelijk bereikt worden, inclusief de state-lees-moment-
   check: pre-hooks die state al synchroniseren voor de aanvaller-conditie ontstaat)
4. Aanvaller-type (publiek/operator/bevoegd/governance/deployer-misconfig — alleen onvertrouwde
   aanvallers tellen zwaar mee)
5. Welk protocolprincipe breekt (solvency/boekhouding/toegang/liveness/volgorde/afwikkeling)
6. Is dit bedoeld gedrag (pas hier getoetst, NA bereikbaarheid, zodat foute documentatie een echte bug
   niet kan maskeren)
7. Echte dollarschade (drempel-check, geen gevoel maar een berekening)
8. Drie-rollen-tegenspraak: een agent bewijst de exploit formeel, een tweede probeert hem actief kapot
   te maken zonder de bewijsvoering vooraf te zien, een derde, onafhankelijke agent oordeelt op basis
   van beide
9. Eindscore, vermenigvuldigend: Bereikbaarheid × Impact × Zekerheid × Principe-helderheid

## Output (wat de gebruiker terugkrijgt)

Een gestructureerd verslag:
- Eindoordeel: INDIENEN-KANDIDAAT / MEER BEWIJS NODIG / WAARSCHIJNLIJK AFGEWEZEN
- Per poort: wat er is gecheckt en de uitkomst, met redenering
- De validity-score
- Het sterkste tegenargument dat de Rechter vond (zodat de gebruiker weet wat hij moet dichttimmeren
  voor hij indient)
- Bij afwijzing: welke standaardcategorie van toepassing is (scope / autoriteit / onmogelijke-staat /
  economie / duplicate / operationele-aanname / bedoeld-gedrag)

## Hoe het verspreid wordt (bewust klein gehouden voor stap 1)

- Command-line tool (Node/TypeScript, zelfde stack als de rest), gebruiker levert eigen LLM-API-sleutel
  aan via env-variabele. Wij dragen geen kosten per gebruiker, geen infrastructuur nodig, dus dit is
  het snelst te bouwen en te verspreiden (npm-publicatie, zelfde patroon als eerdere eigen npm-
  packages van dit account).
- Eventueel aanvullend een simpel webformulier (plak tekst, krijg resultaat) voor mensen die geen CLI
  willen installeren, als lage-drempel-kennismaking. De CLI is de eigenlijke, serieuze distributie.

## Wat BEWUST NIET in stap 1 zit, en waarom

- Geen automatische code-uitvoering, geen Foundry-builds, geen on-chain-simulatie. Dat is duur, traag
  om te bouwen, en een serieus beveiligingsrisico als we vreemde, mogelijk kwaadaardige smart-contract-
  code van onbekende gebruikers zouden uitvoeren op onze eigen infrastructuur.
- Geen automatische hypothese-generatie over een hele repo. De gebruiker levert zijn EIGEN vermoeden
  aan, wij beoordelen het alleen. (Dat generatie-stuk is stap 2.)
- Geen gehoste multi-tenant dienst, geen betaalmuur. Draait lokaal bij de gebruiker met zijn eigen
  sleutel. (Dat is stap 3, alleen als stap 1 en 2 echte vraag laten zien — zelfde "eerst meten, dan
  bouwen"-discipline die elders in dit project al bewezen werkt.)

## Wat er nieuw gebouwd moet worden

1. De kernlogica (scope-poort, bereikbaarheid, aanvaller-type, principe-breuk, intent, impact, drie-
   rollen-tegenspraak, scoring) loshalen uit de interne wazir-al-ghanima-codebase tot een schone,
   op zichzelf staande package zonder project-interne afhankelijkheden (de huidige bestanden
   `src/audit/al-mizaan-filter.ts` en `src/audit/adversarial-debate.ts` zijn het uitgangspunt, maar
   zitten nu vermoedelijk verweven met interne, niet-herbruikbare onderdelen zoals de build-harness en
   Sherlock-only aannames die generieker moeten).
2. Een CLI-ingang: argumenten inlezen, het bestand met bevinding+code inlezen, de beoordeling
   aanroepen, het resultaat leesbaar formatteren.
3. Platform-regels los-koppelbaar maken (Sherlock-specifieke SJIP-regels als eerste ingebouwde set,
   duidelijk gelabeld als zodanig, met ruimte om Immunefi/Cantina-eigen regels later toe te voegen).
4. Verpakken en publiceren op npm.
5. Een duidelijke README met een paar uitgewerkte voorbeelden die laten zien dat het systeem een
   overduidelijk ongeldige bevinding (bv. trusted-actor-only, of generieke Chainlink-staleness) correct
   afwijst — vertrouwen opbouwen zonder gevoelige details van lopende, actieve contests te gebruiken.

## Tijdsinschatting

De kernmethode en de validatie ervan bestaan al. De echte onbekende factor is hoe verweven de huidige
code is met interne, niet-herbruikbare onderdelen — dat wordt in de eerste bouwsessie duidelijk. Geen
maanden, wel meerdere gerichte bouwsessies, niet één middag.

## Voor de context: stappen 2 en 3 (nog niet nu, wel het volledige plaatje)

Stap 2 (later): dezelfde beoordelingslogica uitbreiden zodat het systeem zelf ook hypotheses genereert
over een hele repo, in plaats van dat de gebruiker die zelf aanlevert. Nog steeds lokaal draaiend bij
de gebruiker, geen gehoste dienst.

Stap 3 (pas als 1 en 2 echte vraag bewijzen): een gehoste versie met betaling.
