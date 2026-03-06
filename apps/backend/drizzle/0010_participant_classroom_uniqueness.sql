drop index if exists participant_organization_user_uidx;
drop index if exists participant_organization_email_uidx;

create unique index if not exists participant_organization_classroom_user_uidx
  on participant (organization_id, classroom_id, user_id);

create unique index if not exists participant_organization_classroom_email_uidx
  on participant (organization_id, classroom_id, email);
