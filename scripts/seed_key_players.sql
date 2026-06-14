-- Seed key_players jsonb for all 44 WC2026 teams
-- Run: Supabase Dashboard → SQL Editor → paste and execute
-- Adds key_players column if not present, then seeds data

ALTER TABLE team_profiles ADD COLUMN IF NOT EXISTS key_players jsonb DEFAULT '[]'::jsonb;

UPDATE team_profiles SET key_players = '[
  {"name":"Riyad Mahrez","position":"RW","role":"Captain, creative spark"},
  {"name":"Islam Slimani","position":"ST","role":"Target man"},
  {"name":"Youcef Atal","position":"RB","role":"Attacking fullback"}
]'::jsonb WHERE team_code = 'ALG';

UPDATE team_profiles SET key_players = '[
  {"name":"Lionel Messi","position":"RW","role":"Captain, all-time great"},
  {"name":"Julián Álvarez","position":"ST","role":"Press, goals, assists"},
  {"name":"Rodrigo De Paul","position":"CM","role":"Engine, intensity"},
  {"name":"Nicolás Otamendi","position":"CB","role":"Defensive leader"}
]'::jsonb WHERE team_code = 'ARG';

UPDATE team_profiles SET key_players = '[
  {"name":"Mathew Ryan","position":"GK","role":"Shot-stopper, captain"},
  {"name":"Harry Souttar","position":"CB","role":"Aerial threat, set pieces"},
  {"name":"Mathew Leckie","position":"RW","role":"Pace, dribbling"}
]'::jsonb WHERE team_code = 'AUS';

UPDATE team_profiles SET key_players = '[
  {"name":"David Alaba","position":"CB","role":"Captain, defensive anchor"},
  {"name":"Marcel Sabitzer","position":"CM","role":"Box-to-box energy"},
  {"name":"Marko Arnautovic","position":"ST","role":"Hold-up play, goals"}
]'::jsonb WHERE team_code = 'AUT';

UPDATE team_profiles SET key_players = '[
  {"name":"Kevin De Bruyne","position":"CAM","role":"Captain, creative genius"},
  {"name":"Romelu Lukaku","position":"ST","role":"Target man, finisher"},
  {"name":"Thibaut Courtois","position":"GK","role":"World-class shot-stopper"}
]'::jsonb WHERE team_code = 'BEL';

UPDATE team_profiles SET key_players = '[
  {"name":"Edin Džeko","position":"ST","role":"Captain, experienced finisher"},
  {"name":"Miralem Pjanić","position":"CM","role":"Playmaker, set pieces"},
  {"name":"Sead Kolašinac","position":"LB","role":"Physical fullback"}
]'::jsonb WHERE team_code = 'BIH';

UPDATE team_profiles SET key_players = '[
  {"name":"Vinicius Jr","position":"LW","role":"Pace, dribbling, goals"},
  {"name":"Rodrygo","position":"RW","role":"Creativity, big-game performer"},
  {"name":"Casemiro","position":"CDM","role":"Defensive shield"},
  {"name":"Marquinhos","position":"CB","role":"Captain, defensive leader"}
]'::jsonb WHERE team_code = 'BRA';

UPDATE team_profiles SET key_players = '[
  {"name":"Alphonso Davies","position":"LB","role":"Captain, pace, overlapping runs"},
  {"name":"Jonathan David","position":"ST","role":"Prolific scorer"},
  {"name":"Tajon Buchanan","position":"RW","role":"Pace, direct running"}
]'::jsonb WHERE team_code = 'CAN';

UPDATE team_profiles SET key_players = '[
  {"name":"Nélson Oliveira","position":"ST","role":"Target man, experience"},
  {"name":"Garry Rodrigues","position":"LW","role":"Pace, dribbling"},
  {"name":"Stopira","position":"CB","role":"Defensive organizer"}
]'::jsonb WHERE team_code = 'CPV';

UPDATE team_profiles SET key_players = '[
  {"name":"James Rodríguez","position":"CAM","role":"Creative catalyst, set pieces"},
  {"name":"Falcao","position":"ST","role":"Experienced finisher"},
  {"name":"Davinson Sánchez","position":"CB","role":"Defensive anchor"}
]'::jsonb WHERE team_code = 'COL';

UPDATE team_profiles SET key_players = '[
  {"name":"Luka Modrić","position":"CM","role":"Captain, ball-carrier, vision"},
  {"name":"Ivan Perišić","position":"LW","role":"Energy, goals, assists"},
  {"name":"Mateo Kovačić","position":"CM","role":"Engine, pressing"}
]'::jsonb WHERE team_code = 'CRO';

UPDATE team_profiles SET key_players = '[
  {"name":"Cuco Martina","position":"RB","role":"Experienced defender"},
  {"name":"Leandro Bacuna","position":"CM","role":"Midfield drive"},
  {"name":"Jurgen Mathoera","position":"ST","role":"Physical presence"}
]'::jsonb WHERE team_code = 'CUW';

UPDATE team_profiles SET key_players = '[
  {"name":"Tomáš Souček","position":"CM","role":"Goals from midfield, aerial"},
  {"name":"Patrik Schick","position":"ST","role":"Clinical finisher"},
  {"name":"Vladimír Coufal","position":"RB","role":"Attacking fullback"}
]'::jsonb WHERE team_code = 'CZE';

UPDATE team_profiles SET key_players = '[
  {"name":"Chancel Mbemba","position":"CB","role":"Defensive leader"},
  {"name":"Yannick Bolasie","position":"LW","role":"Pace, direct"},
  {"name":"Cédric Bakambu","position":"ST","role":"Goalscorer"}
]'::jsonb WHERE team_code = 'COD';

UPDATE team_profiles SET key_players = '[
  {"name":"Mohamed Salah","position":"RW","role":"Captain, world-class attacker"},
  {"name":"Omar Marmoush","position":"ST","role":"Goals and creativity"},
  {"name":"Mohamed El Shenawy","position":"GK","role":"Shot-stopper"}
]'::jsonb WHERE team_code = 'EGY';

UPDATE team_profiles SET key_players = '[
  {"name":"Harry Kane","position":"ST","role":"Captain, goal-machine"},
  {"name":"Jude Bellingham","position":"CM","role":"Goals, creativity, leadership"},
  {"name":"Bukayo Saka","position":"RW","role":"Pace, dribbling, assists"},
  {"name":"Phil Foden","position":"LW","role":"Technical brilliance"}
]'::jsonb WHERE team_code = 'ENG';

UPDATE team_profiles SET key_players = '[
  {"name":"Kylian Mbappé","position":"ST","role":"Captain, pace, finishing"},
  {"name":"Antoine Griezmann","position":"CAM","role":"Link play, goals"},
  {"name":"Aurélien Tchouaméni","position":"CDM","role":"Defensive anchor"},
  {"name":"Marcus Thuram","position":"LW","role":"Physical, goals"}
]'::jsonb WHERE team_code = 'FRA';

UPDATE team_profiles SET key_players = '[
  {"name":"Florian Wirtz","position":"CAM","role":"Creative genius, goals"},
  {"name":"Leroy Sané","position":"RW","role":"Pace, direct, assists"},
  {"name":"Kai Havertz","position":"ST","role":"Goals, link play"},
  {"name":"Joshua Kimmich","position":"CM","role":"Engine, leadership"}
]'::jsonb WHERE team_code = 'GER';

UPDATE team_profiles SET key_players = '[
  {"name":"Jordan Ayew","position":"ST","role":"Captain, physical, experienced"},
  {"name":"Mohammed Kudus","position":"CAM","role":"Creative, goals"},
  {"name":"Thomas Partey","position":"CDM","role":"Midfield anchor"}
]'::jsonb WHERE team_code = 'GHA';

UPDATE team_profiles SET key_players = '[
  {"name":"Duckens Nazon","position":"ST","role":"Pace, direct"},
  {"name":"Frantzdy Pierrot","position":"LW","role":"Dribbling, creativity"},
  {"name":"Mechack Jérôme","position":"CB","role":"Defensive organizer"}
]'::jsonb WHERE team_code = 'HAI';

UPDATE team_profiles SET key_players = '[
  {"name":"Mehdi Taremi","position":"ST","role":"Captain, goals, hold-up"},
  {"name":"Sardar Azmoun","position":"ST","role":"Quality finisher"},
  {"name":"Alireza Jahanbakhsh","position":"RW","role":"Pace, dribbling"}
]'::jsonb WHERE team_code = 'IRN';

UPDATE team_profiles SET key_players = '[
  {"name":"Takumi Minamino","position":"LW","role":"Pressing, goals"},
  {"name":"Kaoru Mitoma","position":"LW","role":"Dribbling, pace"},
  {"name":"Wataru Endō","position":"CDM","role":"Captain, defensive screen"},
  {"name":"Hiroki Sakai","position":"RB","role":"Attacking fullback"}
]'::jsonb WHERE team_code = 'JPN';

UPDATE team_profiles SET key_players = '[
  {"name":"Mousa Al-Tamari","position":"LW","role":"Pace, directness"},
  {"name":"Yazan Al-Naimat","position":"ST","role":"Goalscorer"},
  {"name":"Baha Faisal","position":"CB","role":"Defensive leader"}
]'::jsonb WHERE team_code = 'JOR';

UPDATE team_profiles SET key_players = '[
  {"name":"Hirving Lozano","position":"RW","role":"Pace, directness"},
  {"name":"Edson Álvarez","position":"CDM","role":"Captain, midfield anchor"},
  {"name":"Santiago Giménez","position":"ST","role":"Clinical finisher"},
  {"name":"Guillermo Ochoa","position":"GK","role":"Experienced shot-stopper"}
]'::jsonb WHERE team_code = 'MEX';

UPDATE team_profiles SET key_players = '[
  {"name":"Achraf Hakimi","position":"RB","role":"Attacking fullback, pace"},
  {"name":"Hakim Ziyech","position":"CAM","role":"Creativity, set pieces"},
  {"name":"Sofiane Boufal","position":"LW","role":"Dribbling, direct"},
  {"name":"Yassine Bounou","position":"GK","role":"Shot-stopper"}
]'::jsonb WHERE team_code = 'MAR';

UPDATE team_profiles SET key_players = '[
  {"name":"Virgil van Dijk","position":"CB","role":"Captain, defensive leader"},
  {"name":"Memphis Depay","position":"ST","role":"Goals, creativity"},
  {"name":"Frenkie de Jong","position":"CM","role":"Ball progression"},
  {"name":"Cody Gakpo","position":"LW","role":"Goals, versatility"}
]'::jsonb WHERE team_code = 'NED';

UPDATE team_profiles SET key_players = '[
  {"name":"Chris Wood","position":"ST","role":"Captain, aerial threat"},
  {"name":"Clayton Lewis","position":"CM","role":"Engine, set pieces"},
  {"name":"Bill Tuilagi","position":"CB","role":"Physical defender"}
]'::jsonb WHERE team_code = 'NZL';

UPDATE team_profiles SET key_players = '[
  {"name":"Erling Haaland","position":"ST","role":"World-class finisher"},
  {"name":"Martin Ødegaard","position":"CAM","role":"Captain, creativity"},
  {"name":"Sander Berge","position":"CM","role":"Physicality, passing"}
]'::jsonb WHERE team_code = 'NOR';

UPDATE team_profiles SET key_players = '[
  {"name":"Rolando Blackburn","position":"ST","role":"Goalscorer"},
  {"name":"Édgar Bárcenas","position":"RW","role":"Pace, direct"},
  {"name":"Fidel Escobar","position":"CB","role":"Defensive anchor"}
]'::jsonb WHERE team_code = 'PAN';

UPDATE team_profiles SET key_players = '[
  {"name":"Miguel Almirón","position":"CAM","role":"Pace, goals, energy"},
  {"name":"Gustavo Gómez","position":"CB","role":"Captain, defensive leader"},
  {"name":"Ángel Romero","position":"ST","role":"Experienced finisher"}
]'::jsonb WHERE team_code = 'PAR';

UPDATE team_profiles SET key_players = '[
  {"name":"Gianluca Lapadula","position":"ST","role":"Goals, physicality"},
  {"name":"André Carrillo","position":"RW","role":"Pace, direct"},
  {"name":"Renato Tapia","position":"CDM","role":"Captain, defensive anchor"}
]'::jsonb WHERE team_code = 'PER';

UPDATE team_profiles SET key_players = '[
  {"name":"Cristiano Ronaldo","position":"ST","role":"Captain, goal record"},
  {"name":"Bruno Fernandes","position":"CAM","role":"Creativity, goals, assists"},
  {"name":"Bernardo Silva","position":"CM","role":"Work rate, technical"},
  {"name":"Rafael Leão","position":"LW","role":"Pace, dribbling, directness"}
]'::jsonb WHERE team_code = 'POR';

UPDATE team_profiles SET key_players = '[
  {"name":"Akram Afif","position":"LW","role":"Captain, creative, goals"},
  {"name":"Almoez Ali","position":"ST","role":"Top scorer, movement"},
  {"name":"Meshaal Barsham","position":"GK","role":"Shot-stopper"}
]'::jsonb WHERE team_code = 'QAT';

UPDATE team_profiles SET key_players = '[
  {"name":"Salem Al-Dawsari","position":"LW","role":"Captain, pace, dribbling"},
  {"name":"Firas Al-Buraikan","position":"ST","role":"Goals, pace"},
  {"name":"Mohammed Al-Owais","position":"GK","role":"Experienced keeper"}
]'::jsonb WHERE team_code = 'KSA';

UPDATE team_profiles SET key_players = '[
  {"name":"Andrew Robertson","position":"LB","role":"Captain, overlapping runs"},
  {"name":"Scott McTominay","position":"CM","role":"Goals from midfield"},
  {"name":"Kieran Tierney","position":"LB","role":"Defensive solidity"}
]'::jsonb WHERE team_code = 'SCO';

UPDATE team_profiles SET key_players = '[
  {"name":"Sadio Mané","position":"LW","role":"Captain, pace, goals"},
  {"name":"Édouard Mendy","position":"GK","role":"Shot-stopper"},
  {"name":"Kalidou Koulibaly","position":"CB","role":"Defensive rock"}
]'::jsonb WHERE team_code = 'SEN';

UPDATE team_profiles SET key_players = '[
  {"name":"Aleksandar Mitrović","position":"ST","role":"Aerial threat, goals"},
  {"name":"Dušan Tadić","position":"LW","role":"Captain, creativity"},
  {"name":"Sergej Milinković-Savić","position":"CM","role":"Physical, goals"}
]'::jsonb WHERE team_code = 'SRB';

UPDATE team_profiles SET key_players = '[
  {"name":"Bongani Zungu","position":"CM","role":"Midfield anchor"},
  {"name":"Percy Tau","position":"LW","role":"Pace, creativity"},
  {"name":"Ronwen Williams","position":"GK","role":"Shot-stopper"}
]'::jsonb WHERE team_code = 'RSA';

UPDATE team_profiles SET key_players = '[
  {"name":"Son Heung-min","position":"LW","role":"Captain, pace, goals"},
  {"name":"Lee Kang-in","position":"CAM","role":"Creative playmaker"},
  {"name":"Kim Min-jae","position":"CB","role":"Defensive leader"}
]'::jsonb WHERE team_code = 'KOR';

UPDATE team_profiles SET key_players = '[
  {"name":"Pedri","position":"CM","role":"Ball carrier, creativity"},
  {"name":"Lamine Yamal","position":"RW","role":"Dribbling, goals, assists"},
  {"name":"Álvaro Morata","position":"ST","role":"Captain, movement, goals"},
  {"name":"Rodri","position":"CDM","role":"Midfield control"}
]'::jsonb WHERE team_code = 'ESP';

UPDATE team_profiles SET key_players = '[
  {"name":"Granit Xhaka","position":"CM","role":"Captain, leadership, passing"},
  {"name":"Xherdan Shaqiri","position":"RW","role":"Creativity, set pieces"},
  {"name":"Breel Embolo","position":"ST","role":"Pace, physicality"}
]'::jsonb WHERE team_code = 'SUI';

UPDATE team_profiles SET key_players = '[
  {"name":"Hakan Çalhanoğlu","position":"CDM","role":"Captain, midfield control"},
  {"name":"Arda Güler","position":"CAM","role":"Creativity, goals"},
  {"name":"Kenan Yıldız","position":"LW","role":"Pace, direct, young talent"}
]'::jsonb WHERE team_code = 'TUR';

UPDATE team_profiles SET key_players = '[
  {"name":"Luis Suárez","position":"ST","role":"Captain, experienced finisher"},
  {"name":"Darwin Núñez","position":"ST","role":"Pace, physical presence"},
  {"name":"Federico Valverde","position":"CM","role":"Energy, goals, intensity"},
  {"name":"Ronald Araújo","position":"CB","role":"Defensive leader"}
]'::jsonb WHERE team_code = 'URU';

UPDATE team_profiles SET key_players = '[
  {"name":"Christian Pulisic","position":"LW","role":"Captain, creativity, goals"},
  {"name":"Gio Reyna","position":"CAM","role":"Dribbling, vision"},
  {"name":"Weston McKennie","position":"CM","role":"Box-to-box, goals"},
  {"name":"Turner","position":"GK","role":"Shot-stopper"}
]'::jsonb WHERE team_code = 'USA';
