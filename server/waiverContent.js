// Single source of truth for the waiver text, shared by the PDF generator.
// Keep in sync with public/index.html if the legal text ever changes.

const BUSINESS_NAME = 'Northumberland Fitness';
const LOCATION = '1111 Elgin Street West, Cobourg, Ontario';
const TITLE = 'Northumberland Fitness – Liability Waiver & Assumption of Risk';

const SECTIONS = [
  {
    heading: '1. Acknowledgement of Risks',
    body: 'I understand that participation in physical exercise, fitness classes, and the use of gym equipment and facilities at Northumberland Fitness carries inherent risks, including but not limited to muscle strain, sprains, fractures, cardiovascular events, falls, and injury arising from equipment malfunction or improper use.'
  },
  {
    heading: '2. Assumption of Risk',
    body: 'I voluntarily enter the premises and participate in activities at Northumberland Fitness and fully assume all risks of personal injury, illness, property damage, or other harm that may occur as a result. I understand these risks may arise from my own actions, the actions of others, or the condition of the premises or equipment.'
  },
  {
    heading: '3. Release of Liability',
    body: 'In consideration for being permitted to use the facility, I hereby release and forever discharge Northumberland Fitness, its owners, directors, officers, employees, contractors, subcontractors, volunteers, and agents (collectively, the "Released Parties") from any and all claims, demands, actions, or causes of action of whatsoever kind or nature arising out of any injury, damage, or loss that I may suffer while on the premises, INCLUDING CLAIMS ARISING FROM THE NEGLIGENCE OF THE RELEASED PARTIES, to the fullest extent permitted by law. This release does not extend to any injury, damage, or loss caused by the gross negligence or wilful misconduct of the Released Parties.'
  },
  {
    heading: '4. Indemnification',
    body: 'I agree to indemnify and hold harmless Northumberland Fitness from any claims or liability arising from my presence, actions, or conduct at the facility.'
  },
  {
    heading: '5. Compliance with Facility Rules & Safety Instructions',
    body: 'I agree to follow all posted signs, facility rules, safety instructions, and directions provided by Northumberland Fitness staff or authorized personnel. I understand that failure to comply may result in removal from the premises.'
  },
  {
    heading: '6. Physical Condition & Fitness to Participate',
    body: 'I confirm that I am physically fit to participate in exercise activities and am not aware of any medical condition that would make my participation unsafe. I have consulted a physician regarding my ability to safely participate if I have any concerns about my health. I confirm I am not under the influence of alcohol, drugs, or any condition that may impair my judgment or mobility.'
  },
  {
    heading: '7. Minors',
    body: 'This waiver may only be completed and signed by an individual who is at least 18 years of age. A minor (an individual under 18) may not use the facility unless accompanied by a parent or legal guardian, who must sign this waiver on the minor’s behalf, thereby also assuming full responsibility for supervising the minor at all times while on the premises.'
  },
  {
    heading: '8. Severability',
    body: 'If any provision of this waiver is found by a court of competent jurisdiction to be invalid, illegal, or unenforceable, that provision shall be severed from this waiver, and the remaining provisions shall continue in full force and effect.'
  },
  {
    heading: '9. Governing Law',
    body: 'This waiver shall be governed by and construed in accordance with the laws of the Province of Ontario and the federal laws of Canada applicable therein, and I attorn to the exclusive jurisdiction of the courts of Ontario for any dispute arising from this waiver.'
  },
  {
    heading: '10. Voluntary Agreement',
    body: 'I acknowledge that I have read and fully understand this waiver. I sign it voluntarily and without inducement.'
  }
];

module.exports = { BUSINESS_NAME, LOCATION, TITLE, SECTIONS };
