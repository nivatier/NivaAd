"""
Seed script — populates the rss_feeds table with curated feeds
across all major business verticals.

Usage (from backend/ directory, with DB running):
    python scripts/seed_rss_feeds.py

Or via Railway / production shell:
    python scripts/seed_rss_feeds.py

Idempotent — skips any URL that already exists.
"""

import asyncio
import os
import sys

# Make sure app is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from app.config import settings
from app.models import RssFeed

FEEDS = [

    # ── Artificial Intelligence ───────────────────────────────────────────────
    {"category": "Artificial Intelligence", "name": "MIT Technology Review – AI",         "url": "https://www.technologyreview.com/feed/",                              "description": "In-depth AI research and industry analysis from MIT."},
    {"category": "Artificial Intelligence", "name": "DeepMind Blog",                       "url": "https://deepmind.google/blog/rss.xml",                                "description": "Research updates and breakthroughs from Google DeepMind."},
    {"category": "Artificial Intelligence", "name": "OpenAI Blog",                         "url": "https://openai.com/blog/rss.xml",                                     "description": "Official research and product announcements from OpenAI."},
    {"category": "Artificial Intelligence", "name": "The Gradient",                        "url": "https://thegradient.pub/rss/",                                        "description": "Accessible AI research perspectives and commentary."},
    {"category": "Artificial Intelligence", "name": "Hugging Face Blog",                   "url": "https://huggingface.co/blog/feed.xml",                                "description": "Open-source AI models, tools and community updates."},
    {"category": "Artificial Intelligence", "name": "AI Business",                         "url": "https://aibusiness.com/rss.xml",                                      "description": "Enterprise AI adoption, strategy, and investment news."},
    {"category": "Artificial Intelligence", "name": "VentureBeat – AI",                   "url": "https://venturebeat.com/category/ai/feed/",                           "description": "Breaking AI news, funding rounds and product launches."},
    {"category": "Artificial Intelligence", "name": "Towards Data Science",                "url": "https://towardsdatascience.com/feed",                                  "description": "Practical ML, data science tutorials and case studies."},

    # ── Technology ────────────────────────────────────────────────────────────
    {"category": "Technology", "name": "TechCrunch",                            "url": "https://techcrunch.com/feed/",                                        "description": "Startup news, funding, and technology product launches."},
    {"category": "Technology", "name": "The Verge",                             "url": "https://www.theverge.com/rss/index.xml",                              "description": "Consumer tech, science and culture coverage."},
    {"category": "Technology", "name": "Wired",                                 "url": "https://www.wired.com/feed/rss",                                      "description": "How technology shapes culture, economics and society."},
    {"category": "Technology", "name": "Ars Technica",                          "url": "https://feeds.arstechnica.com/arstechnica/index",                     "description": "In-depth technical analysis and science reporting."},
    {"category": "Technology", "name": "ZDNet",                                 "url": "https://www.zdnet.com/news/rss.xml",                                  "description": "Enterprise technology news and product reviews."},
    {"category": "Technology", "name": "Hacker News (Top Stories)",             "url": "https://hnrss.org/frontpage",                                        "description": "Top discussions from the tech and startup community."},
    {"category": "Technology", "name": "IEEE Spectrum",                         "url": "https://spectrum.ieee.org/rss/fulltext",                              "description": "Engineering, electronics, and emerging technology."},
    {"category": "Technology", "name": "InfoQ",                                 "url": "https://feed.infoq.com/",                                            "description": "Software architecture, DevOps, and engineering practices."},

    # ── Cybersecurity ─────────────────────────────────────────────────────────
    {"category": "Cybersecurity", "name": "Krebs on Security",                  "url": "https://krebsonsecurity.com/feed/",                                   "description": "In-depth security news and investigation from Brian Krebs."},
    {"category": "Cybersecurity", "name": "The Hacker News",                    "url": "https://feeds.feedburner.com/TheHackersNews",                         "description": "Cybersecurity news, data breaches, and vulnerability alerts."},
    {"category": "Cybersecurity", "name": "Dark Reading",                       "url": "https://www.darkreading.com/rss.xml",                                 "description": "Enterprise security strategy and threat intelligence."},
    {"category": "Cybersecurity", "name": "Schneier on Security",               "url": "https://www.schneier.com/feed/atom/",                                 "description": "Security expert analysis from Bruce Schneier."},
    {"category": "Cybersecurity", "name": "Bleeping Computer",                  "url": "https://www.bleepingcomputer.com/feed/",                              "description": "Malware alerts, ransomware news, and security advisories."},
    {"category": "Cybersecurity", "name": "CISA Alerts",                        "url": "https://www.cisa.gov/cybersecurity-advisories/feed.xml",              "description": "Official US government cybersecurity advisories and alerts."},

    # ── Healthcare & Medicine ─────────────────────────────────────────────────
    {"category": "Healthcare", "name": "NEJM – New England Journal of Medicine", "url": "https://www.nejm.org/action/showFeed?jc=nejmoa&type=etoc&feed=rss",   "description": "Peer-reviewed clinical research and medical breakthroughs."},
    {"category": "Healthcare", "name": "JAMA Network",                          "url": "https://jamanetwork.com/rss/site_3/67.xml",                           "description": "Clinical studies and public health research."},
    {"category": "Healthcare", "name": "MedPage Today",                         "url": "https://www.medpagetoday.com/rss/headlines.xml",                      "description": "Clinical news and practice updates for healthcare professionals."},
    {"category": "Healthcare", "name": "STAT News",                             "url": "https://www.statnews.com/feed/",                                      "description": "Health, medicine, and life science journalism."},
    {"category": "Healthcare", "name": "Health Affairs",                        "url": "https://www.healthaffairs.org/rss/current.xml",                       "description": "Health policy, economics, and delivery system research."},
    {"category": "Healthcare", "name": "Fierce Healthcare",                     "url": "https://www.fiercehealthcare.com/rss/xml",                            "description": "Hospital, insurance and healthcare industry business news."},
    {"category": "Healthcare", "name": "WebMD Health News",                     "url": "https://rssfeeds.webmd.com/rss/rss.aspx?RSSSource=RSS_PUBLIC",       "description": "Consumer health news and medical research updates."},
    {"category": "Healthcare", "name": "WHO News",                              "url": "https://www.who.int/rss-feeds/news-english.xml",                      "description": "Global health alerts and policy updates from the WHO."},

    # ── Pharmaceuticals & Biotech ─────────────────────────────────────────────
    {"category": "Pharmaceuticals & Biotech", "name": "BioPharma Dive",         "url": "https://www.biopharmadive.com/feeds/news/",                           "description": "Drug development, FDA approvals, and biotech deals."},
    {"category": "Pharmaceuticals & Biotech", "name": "FiercePharma",           "url": "https://www.fiercepharma.com/rss/xml",                               "description": "Pharmaceutical industry pipeline and commercial news."},
    {"category": "Pharmaceuticals & Biotech", "name": "Endpoints News",         "url": "https://endpts.com/feed/",                                           "description": "Biotech and pharma R&D, trials, and funding."},
    {"category": "Pharmaceuticals & Biotech", "name": "Nature Biotechnology",   "url": "https://www.nature.com/nbt.rss",                                     "description": "High-impact biotech research and innovation."},
    {"category": "Pharmaceuticals & Biotech", "name": "GEN – Genetic Engineering & Biotechnology News", "url": "https://www.genengnews.com/feed/",           "description": "Biotech research tools, genomics, and cell therapy updates."},

    # ── Legal ─────────────────────────────────────────────────────────────────
    {"category": "Legal", "name": "Above the Law",                              "url": "https://abovethelaw.com/feed/",                                       "description": "Law firm news, legal industry trends, and career insights."},
    {"category": "Legal", "name": "Law360",                                     "url": "https://www.law360.com/rss",                                         "description": "Breaking legal news across practice areas."},
    {"category": "Legal", "name": "ABA Journal",                                "url": "https://www.abajournal.com/news/rss",                                 "description": "American Bar Association legal news and analysis."},
    {"category": "Legal", "name": "Lexology",                                   "url": "https://www.lexology.com/rss",                                       "description": "Law firm client briefings and legal updates worldwide."},
    {"category": "Legal", "name": "SCOTUSblog",                                 "url": "https://www.scotusblog.com/feed/",                                    "description": "US Supreme Court news, opinions, and case analysis."},
    {"category": "Legal", "name": "Legal Dive",                                 "url": "https://www.legaldive.com/feeds/news/",                               "description": "In-house counsel, corporate legal and compliance news."},
    {"category": "Legal", "name": "Bloomberg Law",                              "url": "https://news.bloomberglaw.com/bloomberglawnews/feed",                  "description": "Legal news covering courts, regulation, and compliance."},

    # ── Finance & Banking ─────────────────────────────────────────────────────
    {"category": "Finance & Banking", "name": "Bloomberg Markets",              "url": "https://feeds.bloomberg.com/markets/news.rss",                        "description": "Global markets, equities, and macroeconomic analysis."},
    {"category": "Finance & Banking", "name": "Financial Times",                "url": "https://www.ft.com/?format=rss",                                      "description": "Global business and financial news."},
    {"category": "Finance & Banking", "name": "Reuters Business",               "url": "https://feeds.reuters.com/reuters/businessNews",                      "description": "Business and financial news from Reuters."},
    {"category": "Finance & Banking", "name": "American Banker",                "url": "https://www.americanbanker.com/rss.xml",                              "description": "Banking industry news, regulation, and fintech."},
    {"category": "Finance & Banking", "name": "CFO Dive",                       "url": "https://www.cfodive.com/feeds/news/",                                 "description": "Finance leadership, treasury, accounting and tax news."},
    {"category": "Finance & Banking", "name": "The Economist – Finance",        "url": "https://www.economist.com/finance-and-economics/rss.xml",             "description": "Economic analysis and financial market commentary."},

    # ── Fintech ───────────────────────────────────────────────────────────────
    {"category": "Fintech", "name": "Finextra",                                 "url": "https://www.finextra.com/rss/headlines.aspx",                         "description": "Financial technology news and innovation."},
    {"category": "Fintech", "name": "Crowdfund Insider",                        "url": "https://www.crowdfundinsider.com/feed/",                              "description": "Fintech, blockchain, and alternative finance news."},
    {"category": "Fintech", "name": "PaymentsSource",                           "url": "https://www.paymentssource.com/feed",                                 "description": "Payments industry news, trends, and strategy."},
    {"category": "Fintech", "name": "The Block – Crypto & Fintech",             "url": "https://www.theblock.co/rss.xml",                                     "description": "Crypto, blockchain, and fintech research and news."},

    # ── Real Estate ───────────────────────────────────────────────────────────
    {"category": "Real Estate", "name": "Inman News",                           "url": "https://www.inman.com/feed/",                                         "description": "Residential real estate news for agents and brokers."},
    {"category": "Real Estate", "name": "CoStar News",                          "url": "https://www.costar.com/rss",                                         "description": "Commercial real estate market data and transactions."},
    {"category": "Real Estate", "name": "Bisnow",                               "url": "https://www.bisnow.com/rss",                                         "description": "Commercial real estate events, deals, and development."},
    {"category": "Real Estate", "name": "Realtor Magazine",                     "url": "https://magazine.realtor/rss.xml",                                   "description": "Housing market trends and NAR member resources."},
    {"category": "Real Estate", "name": "GlobeSt",                              "url": "https://www.globest.com/feed/",                                      "description": "CRE investment, leasing, and industry trends."},

    # ── Manufacturing ─────────────────────────────────────────────────────────
    {"category": "Manufacturing", "name": "Manufacturing Today",                "url": "https://www.manufacturingtoday.com/feed",                             "description": "Industry news for manufacturers and supply chains."},
    {"category": "Manufacturing", "name": "IndustryWeek",                       "url": "https://www.industryweek.com/rss.xml",                               "description": "Manufacturing strategy, operations, and leadership."},
    {"category": "Manufacturing", "name": "Smart Manufacturing",                "url": "https://www.smartmanufacturingmag.com/feed/",                         "description": "Industry 4.0, automation, and digital factory news."},
    {"category": "Manufacturing", "name": "Manufacturing Engineering",          "url": "https://www.sme.org/technologies/articles/feed/",                     "description": "Manufacturing processes, tooling, and engineering innovation."},
    {"category": "Manufacturing", "name": "Quality Magazine",                   "url": "https://www.qualitymag.com/rss.xml",                                  "description": "Quality control, inspection, and testing in manufacturing."},
    {"category": "Manufacturing", "name": "Robotics & Automation News",         "url": "https://roboticsandautomationnews.com/feed/",                         "description": "Industrial robots, cobots, and factory automation updates."},

    # ── Agriculture & AgriTech ────────────────────────────────────────────────
    {"category": "Agriculture & AgriTech", "name": "AgFunder News",             "url": "https://agfundernews.com/feed",                                       "description": "AgriTech startup funding, innovation, and food systems."},
    {"category": "Agriculture & AgriTech", "name": "Successful Farming",        "url": "https://www.agriculture.com/rss.xml",                                 "description": "Practical farming advice, markets, and equipment news."},
    {"category": "Agriculture & AgriTech", "name": "Precision Agriculture",     "url": "https://precisionag.com/feed/",                                      "description": "GPS, drones, sensors, and data-driven crop management."},
    {"category": "Agriculture & AgriTech", "name": "USDA News",                 "url": "https://www.usda.gov/rss/home.xml",                                   "description": "US Department of Agriculture policy and market reports."},
    {"category": "Agriculture & AgriTech", "name": "The Packer",                "url": "https://www.thepacker.com/rss.xml",                                   "description": "Produce industry supply chain and market news."},
    {"category": "Agriculture & AgriTech", "name": "Farm Journal",              "url": "https://www.farmjournal.com/feed",                                    "description": "Row crops, livestock, and agribusiness news."},
    {"category": "Agriculture & AgriTech", "name": "Agri-Pulse",                "url": "https://www.agri-pulse.com/rss.xml",                                  "description": "Agricultural policy, trade, and regulatory updates."},

    # ── Energy & Sustainability ───────────────────────────────────────────────
    {"category": "Energy & Sustainability", "name": "PV Magazine",              "url": "https://www.pv-magazine.com/feed/",                                   "description": "Solar energy news, technology, and markets worldwide."},
    {"category": "Energy & Sustainability", "name": "Renewable Energy World",   "url": "https://www.renewableenergyworld.com/feed/",                          "description": "Wind, solar, and clean energy industry updates."},
    {"category": "Energy & Sustainability", "name": "CleanTechnica",            "url": "https://cleantechnica.com/feed/",                                     "description": "Clean technology, EVs, and sustainability news."},
    {"category": "Energy & Sustainability", "name": "Bloomberg Green",          "url": "https://feeds.bloomberg.com/green/news.rss",                          "description": "Climate, energy transition, and ESG investing."},
    {"category": "Energy & Sustainability", "name": "Oil & Gas Journal",        "url": "https://www.ogj.com/rss",                                            "description": "Upstream, midstream, and downstream oil and gas news."},
    {"category": "Energy & Sustainability", "name": "Greentech Media",          "url": "https://www.greentechmedia.com/feed",                                 "description": "Energy transition technology, storage, and grid news."},
    {"category": "Energy & Sustainability", "name": "Carbon Brief",             "url": "https://www.carbonbrief.org/feed/",                                   "description": "Climate science and policy analysis and data journalism."},

    # ── Retail & E-commerce ───────────────────────────────────────────────────
    {"category": "Retail & E-commerce", "name": "Retail Dive",                  "url": "https://www.retaildive.com/feeds/news/",                              "description": "Retail industry strategy, store closures, and innovation."},
    {"category": "Retail & E-commerce", "name": "Modern Retail",                "url": "https://www.modernretail.co/feed/",                                   "description": "DTC brands, retail tech, and consumer behavior."},
    {"category": "Retail & E-commerce", "name": "Practical Ecommerce",          "url": "https://www.practicalecommerce.com/feed",                             "description": "E-commerce tactics, tools, and merchant advice."},
    {"category": "Retail & E-commerce", "name": "Internet Retailer",            "url": "https://www.digitalcommerce360.com/feed/",                           "description": "Online retail trends, analytics, and benchmarks."},
    {"category": "Retail & E-commerce", "name": "Retail Week",                  "url": "https://www.retail-week.com/rss.xml",                                 "description": "UK and global retail industry news and analysis."},

    # ── Marketing & Advertising ───────────────────────────────────────────────
    {"category": "Marketing", "name": "Marketing Week",                         "url": "https://www.marketingweek.com/feed/",                                 "description": "Brand strategy, media planning, and consumer trends."},
    {"category": "Marketing", "name": "AdAge",                                  "url": "https://adage.com/rss",                                              "description": "Advertising industry news, campaigns, and agency news."},
    {"category": "Marketing", "name": "Content Marketing Institute",            "url": "https://contentmarketinginstitute.com/feed/",                         "description": "Content strategy, storytelling, and ROI measurement."},
    {"category": "Marketing", "name": "HubSpot Blog",                           "url": "https://blog.hubspot.com/marketing/rss.xml",                          "description": "Inbound marketing tactics, SEO, and growth strategies."},
    {"category": "Marketing", "name": "Moz Blog",                               "url": "https://moz.com/blog/feed",                                          "description": "SEO, search ranking, and digital marketing research."},
    {"category": "Marketing", "name": "Social Media Examiner",                  "url": "https://www.socialmediaexaminer.com/feed/",                           "description": "Social media strategy, tools, and platform updates."},
    {"category": "Marketing", "name": "Digiday",                                "url": "https://digiday.com/feed/",                                          "description": "Digital media, advertising, and publishing industry."},

    # ── HR & Workforce ────────────────────────────────────────────────────────
    {"category": "HR & Workforce", "name": "HR Dive",                           "url": "https://www.hrdive.com/feeds/news/",                                  "description": "Human resources news, compliance, and talent strategy."},
    {"category": "HR & Workforce", "name": "SHRM HR News",                      "url": "https://www.shrm.org/rss/pages/news.aspx",                           "description": "Society for Human Resource Management official updates."},
    {"category": "HR & Workforce", "name": "Workforce",                         "url": "https://workforce.com/feed",                                         "description": "Workforce management, employee engagement, and HR tech."},
    {"category": "HR & Workforce", "name": "People Management",                 "url": "https://www.peoplemanagement.co.uk/feed",                             "description": "UK HR and people management professional news."},

    # ── Supply Chain & Logistics ──────────────────────────────────────────────
    {"category": "Supply Chain & Logistics", "name": "Supply Chain Dive",       "url": "https://www.supplychaindive.com/feeds/news/",                         "description": "Supply chain disruptions, procurement, and logistics."},
    {"category": "Supply Chain & Logistics", "name": "Logistics Management",    "url": "https://www.logisticsmgmt.com/rss.xml",                              "description": "Transportation, warehousing, and distribution news."},
    {"category": "Supply Chain & Logistics", "name": "FreightWaves",            "url": "https://www.freightwaves.com/news/feed",                              "description": "Trucking, rail, air, and ocean freight market data."},
    {"category": "Supply Chain & Logistics", "name": "DC Velocity",             "url": "https://www.dcvelocity.com/rss.xml",                                  "description": "Distribution, warehousing, and material handling."},

    # ── Startups & Venture Capital ────────────────────────────────────────────
    {"category": "Startups & VC", "name": "Crunchbase News",                    "url": "https://news.crunchbase.com/feed/",                                   "description": "Startup funding rounds, acquisitions, and investor trends."},
    {"category": "Startups & VC", "name": "TechCrunch – Startups",             "url": "https://techcrunch.com/category/startups/feed/",                      "description": "Early-stage startup launches, pivots, and founder stories."},
    {"category": "Startups & VC", "name": "StrictlyVC",                         "url": "https://www.strictlyvc.com/feed/",                                    "description": "Venture capital fundraising, LP news, and fund launches."},
    {"category": "Startups & VC", "name": "Sifted – European Startups",        "url": "https://sifted.eu/feed",                                             "description": "European startup ecosystem news and founder interviews."},

    # ── Education & EdTech ────────────────────────────────────────────────────
    {"category": "Education & EdTech", "name": "EdSurge",                       "url": "https://www.edsurge.com/articles.rss",                                "description": "Education technology news, products, and policy."},
    {"category": "Education & EdTech", "name": "Inside Higher Ed",              "url": "https://www.insidehighered.com/rss.xml",                              "description": "Higher education policy, research, and campus news."},
    {"category": "Education & EdTech", "name": "Education Week",                "url": "https://www.edweek.org/rss.xml",                                      "description": "K-12 education news, policy, and classroom innovation."},
    {"category": "Education & EdTech", "name": "eLearning Industry",            "url": "https://elearningindustry.com/feed",                                  "description": "Online learning, LMS, and corporate training trends."},

    # ── Automotive & Mobility ─────────────────────────────────────────────────
    {"category": "Automotive & Mobility", "name": "Automotive News",            "url": "https://www.autonews.com/rss.xml",                                    "description": "Auto industry news, sales data, and OEM strategy."},
    {"category": "Automotive & Mobility", "name": "Electrek",                   "url": "https://electrek.co/feed/",                                          "description": "Electric vehicles, Tesla, and clean mobility news."},
    {"category": "Automotive & Mobility", "name": "The Drive",                  "url": "https://www.thedrive.com/rss",                                       "description": "Car culture, tech, and automotive industry analysis."},
    {"category": "Automotive & Mobility", "name": "SAE International",          "url": "https://www.sae.org/xml/rss.xml",                                     "description": "Engineering standards and mobility technology research."},

    # ── Food & Beverage ───────────────────────────────────────────────────────
    {"category": "Food & Beverage", "name": "Food Dive",                        "url": "https://www.fooddive.com/feeds/news/",                                "description": "Food industry trends, CPG launches, and regulation."},
    {"category": "Food & Beverage", "name": "Food Business News",               "url": "https://www.foodbusinessnews.net/rss.xml",                            "description": "Food manufacturing, ingredients, and new product news."},
    {"category": "Food & Beverage", "name": "Nation's Restaurant News",         "url": "https://www.nrn.com/rss.xml",                                        "description": "Restaurant industry operations, trends, and chain news."},
    {"category": "Food & Beverage", "name": "Food Navigator",                   "url": "https://www.foodnavigator.com/rss/",                                  "description": "Ingredients science, health claims, and global food markets."},
    {"category": "Food & Beverage", "name": "Beverage Daily",                   "url": "https://www.beveragedaily.com/rss/",                                  "description": "Soft drinks, beer, wine, spirits, and functional beverages."},

    # ── Insurance ─────────────────────────────────────────────────────────────
    {"category": "Insurance", "name": "Insurance Journal",                      "url": "https://www.insurancejournal.com/rss/news/",                          "description": "Property casualty, specialty, and commercial insurance news."},
    {"category": "Insurance", "name": "Best's Review",                          "url": "https://www.ambest.com/bestsreview/rss.xml",                          "description": "Insurance industry analysis from AM Best."},
    {"category": "Insurance", "name": "Insurance Business",                     "url": "https://www.insurancebusinessmag.com/rss/",                           "description": "Global insurance market news and broker insights."},

    # ── Construction & Architecture ───────────────────────────────────────────
    {"category": "Construction & Architecture", "name": "Construction Dive",    "url": "https://www.constructiondive.com/feeds/news/",                        "description": "Construction industry, project management, and labor news."},
    {"category": "Construction & Architecture", "name": "Engineering News-Record", "url": "https://www.enr.com/rss.xml",                                     "description": "Engineering and construction project news worldwide."},
    {"category": "Construction & Architecture", "name": "Architect Magazine",   "url": "https://www.architectmagazine.com/rss.xml",                          "description": "Architecture design, products, and project features."},
    {"category": "Construction & Architecture", "name": "BD+C Building Design+Construction", "url": "https://www.bdcnetwork.com/rss.xml",                    "description": "Commercial building, design, and construction news."},

    # ── Travel & Hospitality ──────────────────────────────────────────────────
    {"category": "Travel & Hospitality", "name": "Skift",                       "url": "https://skift.com/feed/",                                            "description": "Travel industry strategy, airlines, hotels, and OTAs."},
    {"category": "Travel & Hospitality", "name": "Hotel Management",            "url": "https://www.hotelmanagement.net/rss.xml",                            "description": "Hotel operations, development, and hospitality trends."},
    {"category": "Travel & Hospitality", "name": "Travel Weekly",               "url": "https://www.travelweekly.com/rss.ashx",                              "description": "Travel trade news, cruise, tour, and agency updates."},
    {"category": "Travel & Hospitality", "name": "PhocusWire",                  "url": "https://www.phocuswire.com/feed/",                                   "description": "Travel technology, distribution, and digital innovation."},

    # ── Media & Entertainment ─────────────────────────────────────────────────
    {"category": "Media & Entertainment", "name": "Variety",                    "url": "https://variety.com/feed/",                                          "description": "Film, TV, streaming, and entertainment industry news."},
    {"category": "Media & Entertainment", "name": "The Hollywood Reporter",     "url": "https://www.hollywoodreporter.com/feed/",                            "description": "Film, TV, and entertainment business news."},
    {"category": "Media & Entertainment", "name": "Deadline",                   "url": "https://deadline.com/feed/",                                         "description": "Breaking entertainment industry news and deal-making."},
    {"category": "Media & Entertainment", "name": "Broadcasting & Cable",       "url": "https://www.nexttv.com/rss.xml",                                     "description": "TV, cable, streaming, and broadcast industry news."},

    # ── Aerospace & Defense ───────────────────────────────────────────────────
    {"category": "Aerospace & Defense", "name": "Aviation Week",                "url": "https://aviationweek.com/rss.xml",                                   "description": "Commercial aviation, defense, and aerospace technology."},
    {"category": "Aerospace & Defense", "name": "Space News",                   "url": "https://spacenews.com/feed/",                                        "description": "Space industry, satellite, and launch vehicle news."},
    {"category": "Aerospace & Defense", "name": "Defense News",                 "url": "https://www.defensenews.com/rss.xml",                                "description": "Military technology, procurement, and defense policy."},
    {"category": "Aerospace & Defense", "name": "Breaking Defense",             "url": "https://breakingdefense.com/feed/",                                  "description": "Defense technology, budget, and Pentagon news."},

    # ── Government & Public Sector ────────────────────────────────────────────
    {"category": "Government & Public Sector", "name": "Government Executive",  "url": "https://www.govexec.com/rss/all/",                                   "description": "Federal government management, policy, and technology."},
    {"category": "Government & Public Sector", "name": "Route Fifty",           "url": "https://www.route-fifty.com/rss",                                    "description": "State and local government management and innovation."},
    {"category": "Government & Public Sector", "name": "FedScoop",              "url": "https://fedscoop.com/feed/",                                         "description": "Federal IT, cloud, cybersecurity, and digital services."},

    # ── Science & Research ────────────────────────────────────────────────────
    {"category": "Science & Research", "name": "Nature News",                   "url": "https://www.nature.com/nature.rss",                                  "description": "Groundbreaking scientific research across all disciplines."},
    {"category": "Science & Research", "name": "Science Magazine",              "url": "https://www.science.org/rss/news_current.xml",                       "description": "AAAS peer-reviewed research and science news."},
    {"category": "Science & Research", "name": "Phys.org",                      "url": "https://phys.org/rss-feed/",                                         "description": "Physics, material science, and technology research news."},
    {"category": "Science & Research", "name": "Scientific American",           "url": "https://rss.sciam.com/ScientificAmerican-Global",                    "description": "Science and technology explained for a broad audience."},
    {"category": "Science & Research", "name": "ScienceDaily",                  "url": "https://www.sciencedaily.com/rss/all.xml",                           "description": "Research summaries from universities and institutions."},

    # ── Mental Health & Wellness ──────────────────────────────────────────────
    {"category": "Mental Health & Wellness", "name": "Psychology Today",        "url": "https://www.psychologytoday.com/us/rss.xml",                         "description": "Mental health, therapy, and wellness expert articles."},
    {"category": "Mental Health & Wellness", "name": "Mindful",                 "url": "https://www.mindful.org/feed/",                                      "description": "Mindfulness, meditation, and mental wellbeing practices."},
    {"category": "Mental Health & Wellness", "name": "McKnight's Senior Living","url": "https://www.mcknightsseniorliving.com/rss.xml",                      "description": "Senior care, memory care, and assisted living news."},

    # ── Non-profit & Social Impact ────────────────────────────────────────────
    {"category": "Non-profit & Social Impact", "name": "Nonprofit Quarterly",   "url": "https://nonprofitquarterly.org/feed/",                                "description": "Nonprofit management, governance, and social change."},
    {"category": "Non-profit & Social Impact", "name": "Chronicle of Philanthropy", "url": "https://www.philanthropy.com/feed",                              "description": "Fundraising, giving trends, and nonprofit sector news."},
    {"category": "Non-profit & Social Impact", "name": "Devex",                 "url": "https://www.devex.com/news/rss.xml",                                  "description": "International development, aid, and global health funding."},

    # ── Small Business ────────────────────────────────────────────────────────
    {"category": "Small Business", "name": "Entrepreneur",                      "url": "https://www.entrepreneur.com/latest.rss",                             "description": "Small business growth, franchising, and startup advice."},
    {"category": "Small Business", "name": "Inc. Magazine",                     "url": "https://www.inc.com/rss.xml",                                        "description": "Business strategy, leadership, and SMB growth stories."},
    {"category": "Small Business", "name": "Small Business Trends",             "url": "https://smallbiztrends.com/feed",                                    "description": "SMB news, tools, and practical business advice."},
    {"category": "Small Business", "name": "SCORE Blog",                        "url": "https://www.score.org/blog/rss.xml",                                  "description": "Mentorship, planning, and resources for small business owners."},

]


async def seed():
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    added = 0
    skipped = 0

    async with async_session() as db:
        for feed_data in FEEDS:
            existing = await db.scalar(
                select(RssFeed).where(RssFeed.url == feed_data["url"])
            )
            if existing:
                skipped += 1
                continue

            feed = RssFeed(
                name=feed_data["name"],
                url=feed_data["url"],
                category=feed_data["category"],
                description=feed_data["description"],
                enabled=True,
            )
            db.add(feed)
            added += 1

        await db.commit()

    print(f"\n✅ Seed complete: {added} feeds added, {skipped} already existed.")
    print(f"   Total in catalogue: {added + skipped} feeds across {len(set(f['category'] for f in FEEDS))} categories.")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
