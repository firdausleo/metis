// All match_date values are UTC strings. Format: '2026-06-11T20:00:00Z'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
)

const matches = [

  // GROUP A — Mexico, South Africa, South Korea, Czechia
  { external_id:'WC2026-MEX-RSA-20260611', match_date:'2026-06-11T20:00:00Z', stage:'group', group_name:'A', home_team:'Mexico', away_team:'South Africa', home_team_code:'MEX', away_team_code:'RSA', venue:'Estadio Azteca', city:'Mexico City', status:'upcoming' },
  { external_id:'WC2026-KOR-CZE-20260612', match_date:'2026-06-12T01:00:00Z', stage:'group', group_name:'A', home_team:'South Korea', away_team:'Czechia', home_team_code:'KOR', away_team_code:'CZE', venue:'Estadio Akron', city:'Guadalajara', status:'upcoming' },
  { external_id:'WC2026-MEX-KOR-20260617', match_date:'2026-06-17T20:00:00Z', stage:'group', group_name:'A', home_team:'Mexico', away_team:'South Korea', home_team_code:'MEX', away_team_code:'KOR', venue:'Estadio Azteca', city:'Mexico City', status:'upcoming' },
  { external_id:'WC2026-CZE-RSA-20260618', match_date:'2026-06-18T01:00:00Z', stage:'group', group_name:'A', home_team:'Czechia', away_team:'South Africa', home_team_code:'CZE', away_team_code:'RSA', venue:'Estadio Akron', city:'Guadalajara', status:'upcoming' },
  { external_id:'WC2026-MEX-CZE-20260626', match_date:'2026-06-26T00:00:00Z', stage:'group', group_name:'A', home_team:'Mexico', away_team:'Czechia', home_team_code:'MEX', away_team_code:'CZE', venue:'Estadio Azteca', city:'Mexico City', status:'upcoming' },
  { external_id:'WC2026-RSA-KOR-20260626', match_date:'2026-06-26T00:00:00Z', stage:'group', group_name:'A', home_team:'South Africa', away_team:'South Korea', home_team_code:'RSA', away_team_code:'KOR', venue:'Estadio Akron', city:'Guadalajara', status:'upcoming' },

  // GROUP B — Canada, Switzerland, Qatar, Bosnia-Herzegovina
  { external_id:'WC2026-CAN-BIH-20260612', match_date:'2026-06-12T19:00:00Z', stage:'group', group_name:'B', home_team:'Canada', away_team:'Bosnia-Herzegovina', home_team_code:'CAN', away_team_code:'BIH', venue:'BMO Field', city:'Toronto', status:'upcoming' },
  { external_id:'WC2026-QAT-SUI-20260613', match_date:'2026-06-13T22:00:00Z', stage:'group', group_name:'B', home_team:'Qatar', away_team:'Switzerland', home_team_code:'QAT', away_team_code:'SUI', venue:"Levi's Stadium", city:'San Jose', status:'upcoming' },
  { external_id:'WC2026-CAN-QAT-20260617', match_date:'2026-06-17T22:00:00Z', stage:'group', group_name:'B', home_team:'Canada', away_team:'Qatar', home_team_code:'CAN', away_team_code:'QAT', venue:'BMO Field', city:'Toronto', status:'upcoming' },
  { external_id:'WC2026-SUI-BIH-20260618', match_date:'2026-06-18T19:00:00Z', stage:'group', group_name:'B', home_team:'Switzerland', away_team:'Bosnia-Herzegovina', home_team_code:'SUI', away_team_code:'BIH', venue:'BC Place', city:'Vancouver', status:'upcoming' },
  { external_id:'WC2026-CAN-SUI-20260626', match_date:'2026-06-26T22:00:00Z', stage:'group', group_name:'B', home_team:'Canada', away_team:'Switzerland', home_team_code:'CAN', away_team_code:'SUI', venue:'BC Place', city:'Vancouver', status:'upcoming' },
  { external_id:'WC2026-BIH-QAT-20260626', match_date:'2026-06-26T22:00:00Z', stage:'group', group_name:'B', home_team:'Bosnia-Herzegovina', away_team:'Qatar', home_team_code:'BIH', away_team_code:'QAT', venue:'BMO Field', city:'Toronto', status:'upcoming' },

  // GROUP C — Brazil, Morocco, Haiti, Scotland
  { external_id:'WC2026-BRA-MAR-20260613', match_date:'2026-06-13T23:00:00Z', stage:'group', group_name:'C', home_team:'Brazil', away_team:'Morocco', home_team_code:'BRA', away_team_code:'MAR', venue:'MetLife Stadium', city:'New York/NJ', status:'upcoming' },
  { external_id:'WC2026-HAI-SCO-20260614', match_date:'2026-06-14T02:00:00Z', stage:'group', group_name:'C', home_team:'Haiti', away_team:'Scotland', home_team_code:'HAI', away_team_code:'SCO', venue:'Gillette Stadium', city:'Boston', status:'upcoming' },
  { external_id:'WC2026-BRA-HAI-20260619', match_date:'2026-06-19T22:00:00Z', stage:'group', group_name:'C', home_team:'Brazil', away_team:'Haiti', home_team_code:'BRA', away_team_code:'HAI', venue:'Lincoln Financial', city:'Philadelphia', status:'upcoming' },
  { external_id:'WC2026-SCO-MAR-20260620', match_date:'2026-06-20T01:00:00Z', stage:'group', group_name:'C', home_team:'Scotland', away_team:'Morocco', home_team_code:'SCO', away_team_code:'MAR', venue:'Hard Rock Stadium', city:'Miami', status:'upcoming' },
  { external_id:'WC2026-BRA-SCO-20260624', match_date:'2026-06-24T23:00:00Z', stage:'group', group_name:'C', home_team:'Brazil', away_team:'Scotland', home_team_code:'BRA', away_team_code:'SCO', venue:'Hard Rock Stadium', city:'Miami', status:'upcoming' },
  { external_id:'WC2026-MAR-HAI-20260625', match_date:'2026-06-25T02:00:00Z', stage:'group', group_name:'C', home_team:'Morocco', away_team:'Haiti', home_team_code:'MAR', away_team_code:'HAI', venue:'Lincoln Financial', city:'Philadelphia', status:'upcoming' },

  // GROUP D — USA, Paraguay, Australia, Turkiye
  { external_id:'WC2026-USA-PAR-20260613', match_date:'2026-06-13T01:00:00Z', stage:'group', group_name:'D', home_team:'USA', away_team:'Paraguay', home_team_code:'USA', away_team_code:'PAR', venue:'SoFi Stadium', city:'Los Angeles', status:'upcoming' },
  { external_id:'WC2026-AUS-TUR-20260613', match_date:'2026-06-13T20:00:00Z', stage:'group', group_name:'D', home_team:'Australia', away_team:'Turkiye', home_team_code:'AUS', away_team_code:'TUR', venue:'AT&T Stadium', city:'Dallas', status:'upcoming' },
  { external_id:'WC2026-USA-AUS-20260618', match_date:'2026-06-18T23:00:00Z', stage:'group', group_name:'D', home_team:'USA', away_team:'Australia', home_team_code:'USA', away_team_code:'AUS', venue:'SoFi Stadium', city:'Los Angeles', status:'upcoming' },
  { external_id:'WC2026-TUR-PAR-20260619', match_date:'2026-06-19T02:00:00Z', stage:'group', group_name:'D', home_team:'Turkiye', away_team:'Paraguay', home_team_code:'TUR', away_team_code:'PAR', venue:'AT&T Stadium', city:'Dallas', status:'upcoming' },
  { external_id:'WC2026-USA-TUR-20260625', match_date:'2026-06-25T22:00:00Z', stage:'group', group_name:'D', home_team:'USA', away_team:'Turkiye', home_team_code:'USA', away_team_code:'TUR', venue:'SoFi Stadium', city:'Los Angeles', status:'upcoming' },
  { external_id:'WC2026-PAR-AUS-20260626', match_date:'2026-06-26T01:00:00Z', stage:'group', group_name:'D', home_team:'Paraguay', away_team:'Australia', home_team_code:'PAR', away_team_code:'AUS', venue:'AT&T Stadium', city:'Dallas', status:'upcoming' },

  // GROUP E — Germany, Curacao, Portugal, DR Congo
  { external_id:'WC2026-GER-CUW-20260614', match_date:'2026-06-14T20:00:00Z', stage:'group', group_name:'E', home_team:'Germany', away_team:'Curacao', home_team_code:'GER', away_team_code:'CUW', venue:'NRG Stadium', city:'Houston', status:'upcoming' },
  { external_id:'WC2026-POR-COD-20260615', match_date:'2026-06-15T01:00:00Z', stage:'group', group_name:'E', home_team:'Portugal', away_team:'DR Congo', home_team_code:'POR', away_team_code:'COD', venue:'Lincoln Financial', city:'Philadelphia', status:'upcoming' },
  { external_id:'WC2026-GER-POR-20260619', match_date:'2026-06-19T20:00:00Z', stage:'group', group_name:'E', home_team:'Germany', away_team:'Portugal', home_team_code:'GER', away_team_code:'POR', venue:'NRG Stadium', city:'Houston', status:'upcoming' },
  { external_id:'WC2026-COD-CUW-20260620', match_date:'2026-06-20T23:00:00Z', stage:'group', group_name:'E', home_team:'DR Congo', away_team:'Curacao', home_team_code:'COD', away_team_code:'CUW', venue:'AT&T Stadium', city:'Dallas', status:'upcoming' },
  { external_id:'WC2026-GER-COD-20260625', match_date:'2026-06-25T20:00:00Z', stage:'group', group_name:'E', home_team:'Germany', away_team:'DR Congo', home_team_code:'GER', away_team_code:'COD', venue:'NRG Stadium', city:'Houston', status:'upcoming' },
  { external_id:'WC2026-CUW-POR-20260626', match_date:'2026-06-26T23:00:00Z', stage:'group', group_name:'E', home_team:'Curacao', away_team:'Portugal', home_team_code:'CUW', away_team_code:'POR', venue:'AT&T Stadium', city:'Dallas', status:'upcoming' },

  // GROUP F — Japan, Senegal, Colombia, Serbia
  { external_id:'WC2026-JPN-SEN-20260614', match_date:'2026-06-14T23:00:00Z', stage:'group', group_name:'F', home_team:'Japan', away_team:'Senegal', home_team_code:'JPN', away_team_code:'SEN', venue:"Levi's Stadium", city:'San Jose', status:'upcoming' },
  { external_id:'WC2026-COL-SRB-20260615', match_date:'2026-06-15T02:00:00Z', stage:'group', group_name:'F', home_team:'Colombia', away_team:'Serbia', home_team_code:'COL', away_team_code:'SRB', venue:'SoFi Stadium', city:'Los Angeles', status:'upcoming' },
  { external_id:'WC2026-JPN-COL-20260619', match_date:'2026-06-19T23:00:00Z', stage:'group', group_name:'F', home_team:'Japan', away_team:'Colombia', home_team_code:'JPN', away_team_code:'COL', venue:"Levi's Stadium", city:'San Jose', status:'upcoming' },
  { external_id:'WC2026-SRB-SEN-20260620', match_date:'2026-06-20T02:00:00Z', stage:'group', group_name:'F', home_team:'Serbia', away_team:'Senegal', home_team_code:'SRB', away_team_code:'SEN', venue:'SoFi Stadium', city:'Los Angeles', status:'upcoming' },
  { external_id:'WC2026-JPN-SRB-20260625', match_date:'2026-06-25T23:00:00Z', stage:'group', group_name:'F', home_team:'Japan', away_team:'Serbia', home_team_code:'JPN', away_team_code:'SRB', venue:"Levi's Stadium", city:'San Jose', status:'upcoming' },
  { external_id:'WC2026-SEN-COL-20260626', match_date:'2026-06-26T02:00:00Z', stage:'group', group_name:'F', home_team:'Senegal', away_team:'Colombia', home_team_code:'SEN', away_team_code:'COL', venue:'SoFi Stadium', city:'Los Angeles', status:'upcoming' },

  // GROUP G — Belgium, Egypt, Iran, New Zealand
  { external_id:'WC2026-BEL-EGY-20260615', match_date:'2026-06-15T22:00:00Z', stage:'group', group_name:'G', home_team:'Belgium', away_team:'Egypt', home_team_code:'BEL', away_team_code:'EGY', venue:'Lumen Field', city:'Seattle', status:'upcoming' },
  { external_id:'WC2026-IRN-NZL-20260616', match_date:'2026-06-16T01:00:00Z', stage:'group', group_name:'G', home_team:'Iran', away_team:'New Zealand', home_team_code:'IRN', away_team_code:'NZL', venue:'Arrowhead Stadium', city:'Kansas City', status:'upcoming' },
  { external_id:'WC2026-BEL-IRN-20260620', match_date:'2026-06-20T22:00:00Z', stage:'group', group_name:'G', home_team:'Belgium', away_team:'Iran', home_team_code:'BEL', away_team_code:'IRN', venue:'Lumen Field', city:'Seattle', status:'upcoming' },
  { external_id:'WC2026-NZL-EGY-20260621', match_date:'2026-06-21T01:00:00Z', stage:'group', group_name:'G', home_team:'New Zealand', away_team:'Egypt', home_team_code:'NZL', away_team_code:'EGY', venue:'Arrowhead Stadium', city:'Kansas City', status:'upcoming' },
  { external_id:'WC2026-BEL-NZL-20260626', match_date:'2026-06-26T20:00:00Z', stage:'group', group_name:'G', home_team:'Belgium', away_team:'New Zealand', home_team_code:'BEL', away_team_code:'NZL', venue:'Lumen Field', city:'Seattle', status:'upcoming' },
  { external_id:'WC2026-EGY-IRN-20260627', match_date:'2026-06-27T23:00:00Z', stage:'group', group_name:'G', home_team:'Egypt', away_team:'Iran', home_team_code:'EGY', away_team_code:'IRN', venue:'Arrowhead Stadium', city:'Kansas City', status:'upcoming' },

  // GROUP H — Spain, Cape Verde, Saudi Arabia, Uruguay
  { external_id:'WC2026-ESP-CPV-20260615', match_date:'2026-06-15T19:00:00Z', stage:'group', group_name:'H', home_team:'Spain', away_team:'Cape Verde', home_team_code:'ESP', away_team_code:'CPV', venue:'Mercedes-Benz Stadium', city:'Atlanta', status:'upcoming' },
  { external_id:'WC2026-KSA-URU-20260616', match_date:'2026-06-16T22:00:00Z', stage:'group', group_name:'H', home_team:'Saudi Arabia', away_team:'Uruguay', home_team_code:'KSA', away_team_code:'URU', venue:'Hard Rock Stadium', city:'Miami', status:'upcoming' },
  { external_id:'WC2026-ESP-KSA-20260620', match_date:'2026-06-20T19:00:00Z', stage:'group', group_name:'H', home_team:'Spain', away_team:'Saudi Arabia', home_team_code:'ESP', away_team_code:'KSA', venue:'Mercedes-Benz Stadium', city:'Atlanta', status:'upcoming' },
  { external_id:'WC2026-URU-CPV-20260621', match_date:'2026-06-21T22:00:00Z', stage:'group', group_name:'H', home_team:'Uruguay', away_team:'Cape Verde', home_team_code:'URU', away_team_code:'CPV', venue:'Hard Rock Stadium', city:'Miami', status:'upcoming' },
  { external_id:'WC2026-ESP-URU-20260625', match_date:'2026-06-25T19:00:00Z', stage:'group', group_name:'H', home_team:'Spain', away_team:'Uruguay', home_team_code:'ESP', away_team_code:'URU', venue:'Estadio Akron', city:'Guadalajara', status:'upcoming' },
  { external_id:'WC2026-CPV-KSA-20260626', match_date:'2026-06-26T22:00:00Z', stage:'group', group_name:'H', home_team:'Cape Verde', away_team:'Saudi Arabia', home_team_code:'CPV', away_team_code:'KSA', venue:'Hard Rock Stadium', city:'Miami', status:'upcoming' },

  // GROUP I — France, Senegal, Norway, TBD
  { external_id:'WC2026-FRA-SEN-20260616', match_date:'2026-06-16T23:00:00Z', stage:'group', group_name:'I', home_team:'France', away_team:'Senegal', home_team_code:'FRA', away_team_code:'SEN', venue:'MetLife Stadium', city:'New York/NJ', status:'upcoming' },
  { external_id:'WC2026-NOR-TBD-20260617', match_date:'2026-06-17T02:00:00Z', stage:'group', group_name:'I', home_team:'Norway', away_team:'TBD', home_team_code:'NOR', away_team_code:'TBD', venue:'Lincoln Financial', city:'Philadelphia', status:'upcoming' },
  { external_id:'WC2026-FRA-NOR-20260621', match_date:'2026-06-21T23:00:00Z', stage:'group', group_name:'I', home_team:'France', away_team:'Norway', home_team_code:'FRA', away_team_code:'NOR', venue:'Gillette Stadium', city:'Boston', status:'upcoming' },
  { external_id:'WC2026-TBD-SEN-20260622', match_date:'2026-06-22T02:00:00Z', stage:'group', group_name:'I', home_team:'TBD', away_team:'Senegal', home_team_code:'TBD', away_team_code:'SEN', venue:'Lincoln Financial', city:'Philadelphia', status:'upcoming' },
  { external_id:'WC2026-FRA-TBD-20260627', match_date:'2026-06-27T22:00:00Z', stage:'group', group_name:'I', home_team:'France', away_team:'TBD', home_team_code:'FRA', away_team_code:'TBD', venue:'MetLife Stadium', city:'New York/NJ', status:'upcoming' },
  { external_id:'WC2026-SEN-NOR-20260628', match_date:'2026-06-28T01:00:00Z', stage:'group', group_name:'I', home_team:'Senegal', away_team:'Norway', home_team_code:'SEN', away_team_code:'NOR', venue:'Gillette Stadium', city:'Boston', status:'upcoming' },

  // GROUP J — Argentina, Algeria, Austria, Jordan
  { external_id:'WC2026-ARG-ALG-20260617', match_date:'2026-06-17T01:00:00Z', stage:'group', group_name:'J', home_team:'Argentina', away_team:'Algeria', home_team_code:'ARG', away_team_code:'ALG', venue:'Arrowhead Stadium', city:'Kansas City', status:'upcoming' },
  { external_id:'WC2026-AUT-JOR-20260617', match_date:'2026-06-17T20:00:00Z', stage:'group', group_name:'J', home_team:'Austria', away_team:'Jordan', home_team_code:'AUT', away_team_code:'JOR', venue:'AT&T Stadium', city:'Dallas', status:'upcoming' },
  { external_id:'WC2026-ARG-AUT-20260621', match_date:'2026-06-21T20:00:00Z', stage:'group', group_name:'J', home_team:'Argentina', away_team:'Austria', home_team_code:'ARG', away_team_code:'AUT', venue:'Arrowhead Stadium', city:'Kansas City', status:'upcoming' },
  { external_id:'WC2026-JOR-ALG-20260622', match_date:'2026-06-22T23:00:00Z', stage:'group', group_name:'J', home_team:'Jordan', away_team:'Algeria', home_team_code:'JOR', away_team_code:'ALG', venue:'AT&T Stadium', city:'Dallas', status:'upcoming' },
  { external_id:'WC2026-ARG-JOR-20260627', match_date:'2026-06-27T01:00:00Z', stage:'group', group_name:'J', home_team:'Argentina', away_team:'Jordan', home_team_code:'ARG', away_team_code:'JOR', venue:'Arrowhead Stadium', city:'Kansas City', status:'upcoming' },
  { external_id:'WC2026-ALG-AUT-20260627', match_date:'2026-06-27T20:00:00Z', stage:'group', group_name:'J', home_team:'Algeria', away_team:'Austria', home_team_code:'ALG', away_team_code:'AUT', venue:'AT&T Stadium', city:'Dallas', status:'upcoming' },

  // GROUP K — Netherlands, Senegal, Peru, TBD
  { external_id:'WC2026-NED-SEN-20260616', match_date:'2026-06-16T19:00:00Z', stage:'group', group_name:'K', home_team:'Netherlands', away_team:'Senegal', home_team_code:'NED', away_team_code:'SEN', venue:'Rose Bowl', city:'Los Angeles', status:'upcoming' },
  { external_id:'WC2026-PER-TBD-20260617', match_date:'2026-06-17T22:00:00Z', stage:'group', group_name:'K', home_team:'Peru', away_team:'TBD', home_team_code:'PER', away_team_code:'TBD', venue:'NRG Stadium', city:'Houston', status:'upcoming' },
  { external_id:'WC2026-NED-PER-20260621', match_date:'2026-06-21T19:00:00Z', stage:'group', group_name:'K', home_team:'Netherlands', away_team:'Peru', home_team_code:'NED', away_team_code:'PER', venue:'Rose Bowl', city:'Los Angeles', status:'upcoming' },
  { external_id:'WC2026-TBD-SEN-20260622K', match_date:'2026-06-22T22:00:00Z', stage:'group', group_name:'K', home_team:'TBD', away_team:'Senegal', home_team_code:'TBD', away_team_code:'SEN', venue:'NRG Stadium', city:'Houston', status:'upcoming' },
  { external_id:'WC2026-NED-TBD-20260627', match_date:'2026-06-27T19:00:00Z', stage:'group', group_name:'K', home_team:'Netherlands', away_team:'TBD', home_team_code:'NED', away_team_code:'TBD', venue:'Rose Bowl', city:'Los Angeles', status:'upcoming' },
  { external_id:'WC2026-SEN-PER-20260628', match_date:'2026-06-28T22:00:00Z', stage:'group', group_name:'K', home_team:'Senegal', away_team:'Peru', home_team_code:'SEN', away_team_code:'PER', venue:'NRG Stadium', city:'Houston', status:'upcoming' },

  // GROUP L — England, Croatia, Ghana, Panama
  { external_id:'WC2026-ENG-CRO-20260616', match_date:'2026-06-16T20:00:00Z', stage:'group', group_name:'L', home_team:'England', away_team:'Croatia', home_team_code:'ENG', away_team_code:'CRO', venue:'Gillette Stadium', city:'Boston', status:'upcoming' },
  { external_id:'WC2026-GHA-PAN-20260617', match_date:'2026-06-17T23:00:00Z', stage:'group', group_name:'L', home_team:'Ghana', away_team:'Panama', home_team_code:'GHA', away_team_code:'PAN', venue:'MetLife Stadium', city:'New York/NJ', status:'upcoming' },
  { external_id:'WC2026-ENG-GHA-20260622', match_date:'2026-06-22T20:00:00Z', stage:'group', group_name:'L', home_team:'England', away_team:'Ghana', home_team_code:'ENG', away_team_code:'GHA', venue:'Gillette Stadium', city:'Boston', status:'upcoming' },
  { external_id:'WC2026-PAN-CRO-20260623', match_date:'2026-06-23T23:00:00Z', stage:'group', group_name:'L', home_team:'Panama', away_team:'Croatia', home_team_code:'PAN', away_team_code:'CRO', venue:'MetLife Stadium', city:'New York/NJ', status:'upcoming' },
  { external_id:'WC2026-ENG-PAN-20260627', match_date:'2026-06-27T23:00:00Z', stage:'group', group_name:'L', home_team:'England', away_team:'Panama', home_team_code:'ENG', away_team_code:'PAN', venue:'MetLife Stadium', city:'New York/NJ', status:'upcoming' },
  { external_id:'WC2026-CRO-GHA-20260628', match_date:'2026-06-28T20:00:00Z', stage:'group', group_name:'L', home_team:'Croatia', away_team:'Ghana', home_team_code:'CRO', away_team_code:'GHA', venue:'Gillette Stadium', city:'Boston', status:'upcoming' },

  // ROUND OF 32 — 16 bracket slots
  { external_id:'WC2026-R32-01', match_date:'2026-06-29T19:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-02', match_date:'2026-06-29T22:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-03', match_date:'2026-06-30T01:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-04', match_date:'2026-06-30T19:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-05', match_date:'2026-06-30T22:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-06', match_date:'2026-07-01T01:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-07', match_date:'2026-07-01T19:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-08', match_date:'2026-07-01T22:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-09', match_date:'2026-07-02T01:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-10', match_date:'2026-07-02T19:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-11', match_date:'2026-07-02T22:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-12', match_date:'2026-07-03T01:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-13', match_date:'2026-07-03T19:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-14', match_date:'2026-07-03T22:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-15', match_date:'2026-07-04T01:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R32-16', match_date:'2026-07-04T19:00:00Z', stage:'r32', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },

  // ROUND OF 16 — 8 bracket slots
  { external_id:'WC2026-R16-01', match_date:'2026-07-07T19:00:00Z', stage:'r16', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R16-02', match_date:'2026-07-07T22:00:00Z', stage:'r16', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R16-03', match_date:'2026-07-08T19:00:00Z', stage:'r16', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R16-04', match_date:'2026-07-08T22:00:00Z', stage:'r16', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R16-05', match_date:'2026-07-09T19:00:00Z', stage:'r16', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R16-06', match_date:'2026-07-09T22:00:00Z', stage:'r16', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R16-07', match_date:'2026-07-10T19:00:00Z', stage:'r16', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-R16-08', match_date:'2026-07-10T22:00:00Z', stage:'r16', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },

  // QUARTERFINALS — 4 matches
  { external_id:'WC2026-QF-01', match_date:'2026-07-11T21:00:00Z', stage:'qf', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-QF-02', match_date:'2026-07-12T01:00:00Z', stage:'qf', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-QF-03', match_date:'2026-07-13T21:00:00Z', stage:'qf', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-QF-04', match_date:'2026-07-14T01:00:00Z', stage:'qf', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },

  // SEMIFINALS — 2 matches
  { external_id:'WC2026-SF-01', match_date:'2026-07-15T23:00:00Z', stage:'sf', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-SF-02', match_date:'2026-07-16T23:00:00Z', stage:'sf', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },

  // THIRD PLACE + FINAL
  { external_id:'WC2026-3RD',   match_date:'2026-07-18T23:00:00Z', stage:'3rd',   group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'TBD', city:'TBD', status:'upcoming' },
  { external_id:'WC2026-FINAL', match_date:'2026-07-19T23:00:00Z', stage:'final', group_name:null, home_team:'TBD', away_team:'TBD', home_team_code:'TBD', away_team_code:'TBD', venue:'MetLife Stadium', city:'New York/NJ', status:'upcoming' },
]

async function seed() {
  console.log(`Seeding ${matches.length} matches...`)

  const groups = [...new Set(matches.filter(m => m.stage === 'group').map(m => m.group_name))]
  for (const g of groups.sort()) {
    const groupMatches = matches.filter(m => m.group_name === g)
    console.log(`  Group ${g}: ${groupMatches.length} matches`)
  }

  const { data, error } = await supabase
    .from('matches')
    .upsert(matches, { onConflict: 'external_id' })
    .select()

  if (error) {
    console.error('Seed failed:', error.message)
    process.exit(1)
  }

  const groupCount  = matches.filter(m => m.stage === 'group').length
  const knockoutCount = matches.filter(m => m.stage !== 'group').length

  console.log(`\n✅ Seeded ${data.length} matches successfully`)
  console.log(`   Group stage:     ${groupCount} matches`)
  console.log(`   Knockout slots:  ${knockoutCount} matches`)
}

seed()
